"""Back up the staging database, and prove the backup restores (#35).

  python scripts/backup_database.py backup FILE             dump the `public` schema into FILE
  python scripts/backup_database.py check FILE [COPY]       restore FILE into a NEW local database COPY
                                                             (default restore_check) and compare it with the source

Why one script: it passes binary data through Python (PowerShell's `>` rewrites it), keeps the password off every
command line and out of every message, writes no files in the container, and refuses to put a dump inside this
repository.

The database to back up is named by BACKUP_DATABASE_URL, the Supabase *session pooler* address
(postgresql://postgres.<ref>:<your database password>@<host>:5432/postgres?sslmode=require), taken from the
environment or, if it is not set, from backend/.env.backup. That file is git-ignored AND is not read by Django: do
not put the address in backend/.env, whose every line is loaded into Django's environment (and shown, unmasked,
on its debug error page). The address is split into PGHOST, PGUSER, PGPASSWORD ... and handed to the container by
NAME, so it never appears in an argument list; a message that mentions the password has it replaced, and an
unexpected error is reported by its class only.

Needs Docker with the project's database container up (default sual-cavab-db-1; set BACKUP_CONTAINER to change it).
`check` only reads the source, and never drops or overwrites a database: the copy must not exist, or be a plain
empty database (no tables, sequences, views, functions or other schemas, and not a template). Exit status 0 only if
the dump restored and every comparison matched.

The comparison covers every table's rows (a checksum of their contents, in the "C" collation and in UTC, with the
text-formatting settings pinned so two servers do not disagree), and the columns (exact types such as varchar(50),
nullability, defaults, identity, collation, order), indexes, constraints, sequences (definition and position), table
options (persistence, row-level security, comments), triggers, views and functions of `public`. It does not cover
grants or owners (the dump leaves them out), other schemas, or how the dump behaves restored into Supabase itself.
"""

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

REPO = Path(__file__).resolve().parent.parent
CONTAINER = os.environ.get("BACKUP_CONTAINER", "sual-cavab-db-1")
PG_VARS = ("PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGSSLMODE", "PGTZ", "PGOPTIONS")
# Session settings that change how values are printed: pinned on both sides so a different default is not a "difference".
PINNED = "-c DateStyle=ISO,MDY -c IntervalStyle=postgres -c bytea_output=hex -c extra_float_digits=1 -c search_path=public"
RESERVED_COPY_NAMES = {"postgres", "template0", "template1", "sual_cavab"}
COPY_NAME = re.compile(r"^[a-z][a-z0-9_]{0,62}$")

LIST_TABLES = "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1"
# How many things exist in a database that should be empty: relations, functions, extra schemas, and 1 if it is a template.
EMPTY_DATABASE = (
    "select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace "
    "where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast'))"
    " + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname not in ('pg_catalog', 'information_schema'))"
    " + (select count(*) from pg_namespace where nspname not in ('public', 'information_schema') and nspname !~ '^pg_')"
    " + (select count(*) from pg_database where datname = current_database() and datistemplate)"
)


def described(elements_sql):
    """A query giving 'how many|checksum' for the descriptions `elements_sql` produces, ordered as text in the "C" collation."""
    return f"select count(*), coalesce(md5(string_agg(x, '|' order by x collate \"C\")), '-') from ({elements_sql}) s(x)"


SCHEMA_CHECKS = {
    "columns": described(
        "select c.relname || '.' || row_number() over (partition by c.relname order by a.attnum) || '.' || a.attname || ':' || "
        "format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || a.attidentity::text || ':' || a.attgenerated::text || ':' || "
        "coalesce(pg_get_expr(d.adbin, d.adrelid), '-') || ':' || coalesce(k.collname, '-') "
        "from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace "
        "left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum "
        "left join pg_collation k on k.oid = a.attcollation and k.oid <> 100 "
        "where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped"
    ),
    "indexes": described("select tablename || '.' || indexname || ':' || indexdef from pg_indexes where schemaname = 'public'"),
    "constraints": described(
        "select conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace"
    ),
    "sequences": described(
        "select sequencename || ':' || data_type::text || ':' || start_value || ':' || min_value || ':' || max_value || ':' || increment_by || ':' || cycle::text || ':' || "
        "coalesce(last_value::text, '-') from pg_sequences where schemaname = 'public'"
    ),
    "table options": described(
        "select c.relname || ':' || c.relkind::text || ':' || c.relpersistence::text || ':' || c.relrowsecurity::text || ':' || coalesce(obj_description(c.oid, 'pg_class'), '-') "
        "from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')"
    ),
    "triggers": described(
        "select tgrelid::regclass::text || '.' || tgname || ':' || pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid = t.tgrelid "
        "join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal"
    ),
    "views": described(
        "select 'v:' || viewname || ':' || definition from pg_views where schemaname = 'public' "
        "union all select 'm:' || matviewname || ':' || definition from pg_matviews where schemaname = 'public'"
    ),
    "functions": described(
        "select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || md5(pg_get_functiondef(p.oid)) "
        "from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind in ('f', 'p')"
    ),
}


class Fail(Exception):
    """A problem to report in one line (never containing the address or the password)."""


def read_url():
    url = os.environ.get("BACKUP_DATABASE_URL")
    if url is None:
        env_file = REPO / "backend" / ".env.backup"
        if env_file.exists():
            for line in env_file.read_text(encoding="utf-8").splitlines():
                if line.startswith("BACKUP_DATABASE_URL="):
                    url = line.split("=", 1)[1]
    if not url or not url.strip():
        raise Fail("BACKUP_DATABASE_URL is not set (the environment, or backend/.env.backup).")
    return url.strip().strip("\"'").strip()


def parse_source(url):
    """The PG* environment for `url`. Raises Fail without ever quoting the address or the password."""
    try:
        parts = urlsplit(url)
        port = parts.port or 5432
        options = parse_qs(parts.query)
    except ValueError:
        raise Fail("BACKUP_DATABASE_URL is not a valid address.") from None
    if parts.scheme not in ("postgres", "postgresql") or not parts.hostname or not parts.username or parts.password is None:
        raise Fail("BACKUP_DATABASE_URL must look like postgresql://<user>:<your database password>@<host>:5432/<database>?sslmode=require.")
    name = unquote(parts.path.lstrip("/"))
    if not name:
        raise Fail("BACKUP_DATABASE_URL needs a database name after the host.")
    password = unquote(parts.password)
    if "\x00" in password or "\x00" in name or "\x00" in parts.username:
        raise Fail("BACKUP_DATABASE_URL contains a character that cannot be used.")
    return {
        "PGHOST": parts.hostname,
        "PGPORT": str(port),
        "PGUSER": unquote(parts.username),
        "PGPASSWORD": password,
        "PGDATABASE": name,
        "PGSSLMODE": (options.get("sslmode") or ["require"])[-1],
    }


def scrub(text, secrets):
    """`text` with every secret (also in lower and upper case, which libpq sometimes prints) replaced by ***."""
    for secret in secrets:
        if secret:
            for variant in (secret, secret.lower(), secret.upper()):
                text = text.replace(variant, "***")
    return text


def check_copy_name(name):
    if not COPY_NAME.match(name):
        raise Fail("the copy's name must be lower case letters, digits and underscores, starting with a letter (at most 63).")
    if name in RESERVED_COPY_NAMES:
        raise Fail(f"{name} is not a name for a copy: it must be a new database made for this.")


class Source:
    """The database being backed up, and the way to run things against it inside the container."""

    def __init__(self, url, container=CONTAINER):
        self.container = container
        self.env = parse_source(url)
        self.secrets = [self.env["PGPASSWORD"], url]

    def exec_args(self, argv, *, interactive=False):
        names = []
        for name in PG_VARS:
            names += ["-e", name]
        return ["docker", "exec", *(["-i"] if interactive else []), *names, self.container, *argv]

    def environ(self):
        return {**os.environ, **self.env, "PGTZ": "UTC", "PGOPTIONS": PINNED}


def run(args, *, env=None, stdin=None, stdout=None, secrets=()):
    result = subprocess.run(args, env=env, stdin=stdin, stdout=stdout if stdout else subprocess.PIPE, stderr=subprocess.PIPE)
    out = b"" if stdout else result.stdout
    return result.returncode, out.decode("utf-8", "replace").strip(), scrub(result.stderr.decode("utf-8", "replace").strip(), secrets)[:300]


def query(source, side, sql, copy):
    """One query on the source or on the local copy (inside the container); returns its output."""
    if side == "source":
        code, out, err = run(source.exec_args(["sh", "-c", 'psql -Atc "$1"', "sh", sql]), env=source.environ(), secrets=source.secrets)
    else:
        code, out, err = run(
            ["docker", "exec", "-e", "PGTZ=UTC", "-e", f"PGOPTIONS={PINNED}", source.container, "sh", "-c", f'psql -U "$POSTGRES_USER" -d {copy} -Atc "$1"', "sh", sql],
            secrets=source.secrets,
        )
    if code != 0:
        raise Fail(f"a query failed on the {side}: {err or 'no message'}")
    return out


def local(sql, database="postgres", container=CONTAINER):
    code, out, err = run(["docker", "exec", container, "sh", "-c", f'psql -U "$POSTGRES_USER" -d {database} -Atc "$1"', "sh", sql])
    if code != 0:
        raise Fail(f"a local query failed: {err or 'no message'}")
    return out


def quoted(name):
    return '"' + name.replace('"', '""') + '"'


def backup(source, target):
    path = Path(target).expanduser().resolve()
    if str(path).startswith(chr(92) * 2):
        raise Fail("network (UNC) and extended-length paths are not supported: use a folder on a drive letter.")
    if REPO in (path, *path.parents):
        raise Fail(f"{path} is inside this repository: a dump holds every row, so put it somewhere else.")
    if path.exists():
        raise Fail(f"{path} already exists: not overwriting it.")
    if not path.parent.is_dir():
        raise Fail(f"{path.parent} does not exist: create the folder first.")
    partial = path.with_name(path.name + ".partial")  # the real name appears only when the dump is whole
    if partial.exists():
        raise Fail(f"{partial} is left over from an earlier attempt: delete it first.")
    command = source.exec_args(["sh", "-c", "pg_dump -n public -Fc --no-owner --no-acl"])
    try:
        with open(partial, "wb") as handle:
            code, _, err = run(command, env=source.environ(), stdout=handle, secrets=source.secrets)
        if code != 0:
            raise Fail(f"pg_dump failed: {err or 'no message'}")
        os.replace(partial, path)
    finally:
        partial.unlink(missing_ok=True)  # our own half-written file, on any failure or interruption
    print(f"dump written: {path} ({path.stat().st_size} bytes)")
    print("It holds every row, including password hashes and live session keys: treat it like a password.")


def check(source, dump, copy):
    check_copy_name(copy)
    path = Path(dump).expanduser().resolve()
    if not path.is_file():
        raise Fail(f"{path} is not a file.")
    if local(f"select count(*) from pg_database where datname = '{copy}'") != "0":
        busy = local(EMPTY_DATABASE, copy)
        if busy != "0":
            raise Fail(f"{copy} already exists and is not an empty database ({busy} object(s), or a template): not touching it. Use another name.")
        print(f"reusing the empty {copy}")
    else:
        local(f"CREATE DATABASE {copy}")
        print(f"created {copy}")
    local("DROP SCHEMA IF EXISTS public", copy)  # a new database has an empty one; the dump creates it. No CASCADE: it must be empty.
    with open(path, "rb") as handle:
        code, _, err = run(
            ["docker", "exec", "-i", source.container, "sh", "-c", f'pg_restore -U "$POSTGRES_USER" -d {copy} --no-owner --no-acl --exit-on-error'],
            stdin=handle,
        )
    if code != 0:
        raise Fail(f"pg_restore failed: {err or 'no message'}. The copy {copy} was left behind and is not usable: DROP DATABASE {copy}")
    print("restore finished without error")
    problems = compare(source, copy)
    print(f"The copy {copy} is still there (it holds every row, including live session keys). When done: DROP DATABASE {copy}")
    return 0 if problems == 0 else 1


def compare(source, copy):
    """Print one line per table and per schema check; return how many differ."""
    problems = 0
    source_tables, copy_tables = query(source, "source", LIST_TABLES, copy).splitlines(), query(source, "copy", LIST_TABLES, copy).splitlines()
    if not source_tables:
        raise Fail("the source has no tables in `public`: wrong database? Nothing to compare.")
    print(f"tables: {len(source_tables)} in the source, {len(copy_tables)} in {copy}")
    if source_tables != copy_tables:
        problems += 1
        print("DIFF the lists of tables differ")
    for table in source_tables:
        sql = f'select count(*), coalesce(md5(string_agg(t::text, chr(124) order by t::text collate "C")), chr(45)) from public.{quoted(table)} t'
        a = query(source, "source", sql, copy)
        try:
            b = query(source, "copy", sql, copy)
        except Fail as exc:
            b = f"missing or unreadable in the copy ({exc})"[:120]
        same = a == b
        problems += 0 if same else 1
        rows, _, checksum = a.partition("|")
        print(f"{'same' if same else 'DIFF'} {table:<34} {rows:>6} rows  {checksum[:8]}" + ("" if same else f"  (copy: {b[:80]})"))
    for name, sql in SCHEMA_CHECKS.items():
        a, b = query(source, "source", sql, copy), query(source, "copy", sql, copy)
        problems += 0 if a == b else 1
        print(f"{'same' if a == b else 'DIFF'} {name:<34} {a.split('|')[0]:>6} items {a.partition('|')[2][:8]}" + ("" if a == b else f"  (copy: {b[:50]})"))
    print(f"differences: {problems}")
    return problems


def main(argv=None):
    parser = argparse.ArgumentParser(description="Back up the staging database and prove the backup restores (#35).")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("backup", help="dump the public schema into FILE").add_argument("file")
    c = commands.add_parser("check", help="restore FILE into a new local database and compare")
    c.add_argument("file")
    c.add_argument("copy", nargs="?", default="restore_check")
    args = parser.parse_args(argv)
    try:
        if args.command == "check":
            check_copy_name(args.copy)
        source = Source(read_url())
        if args.command == "backup":
            backup(source, args.file)
            return 0
        return check(source, args.file, args.copy)
    except Fail as exc:
        print(f"FAILED: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # its message could hold the address: say only what kind of error it was
        print(f"FAILED: unexpected {type(exc).__name__} (its message is withheld, it may contain the address).", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
