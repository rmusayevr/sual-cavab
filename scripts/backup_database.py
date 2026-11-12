"""Back up the staging database, and prove the backup restores (#35).

  python scripts/backup_database.py backup FILE             dump the `public` schema into FILE
  python scripts/backup_database.py check FILE [COPY]       restore FILE into a NEW local database COPY
                                                             (default restore_check) and compare it with the source

Why one script: it passes binary data through Python (PowerShell's `>` rewrites it), keeps the password off every
command line and out of every message, writes no temporary files in the container (so there is nothing to delete
there), and refuses to put a dump inside this repository.

The database to back up is named by BACKUP_DATABASE_URL, the Supabase *session pooler* address
(postgresql://postgres.<ref>:<password>@<host>:5432/postgres?sslmode=require), taken from the environment or, if
it is not set, from backend/.env (git-ignored; keep it OUT of DJANGO_DATABASE_URL, which would point the tests at it).
The address is split into PGHOST, PGUSER, PGPASSWORD ... and handed to the container by NAME, so it never appears in
an argument list; a message that mentions the password has it replaced.

Needs Docker with the project's database container up (default sual-cavab-db-1; set BACKUP_CONTAINER to change it).
`check` never touches the source except to read it, and never drops anything: the copy must not exist, or be empty.
Exit status 0 only if the dump restored and every comparison matched.

The comparison covers every table's rows (a checksum of their contents, in the "C" collation and in UTC, so two servers
do not disagree about sort order or time zones), and the columns, indexes, constraints and sequence positions. It does
not cover views, functions or grants (the app has none), nor how the dump behaves restored into Supabase itself.
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

REPO = Path(__file__).resolve().parent.parent
CONTAINER = os.environ.get("BACKUP_CONTAINER", "sual-cavab-db-1")
PG_VARS = ("PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGSSLMODE")

LIST_TABLES = "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1"
SCHEMA_CHECKS = {
    "columns": (
        "select count(*), coalesce(md5(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || "
        "is_identity || ':' || coalesce(column_default, '-'), '|' order by table_name, column_name collate \"C\")), '-') "
        "from information_schema.columns where table_schema = 'public'"
    ),
    "indexes": (
        "select count(*), coalesce(md5(string_agg(tablename || '.' || indexname || ':' || indexdef, '|' "
        "order by tablename, indexname collate \"C\")), '-') from pg_indexes where schemaname = 'public'"
    ),
    "constraints": (
        "select count(*), coalesce(md5(string_agg(conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid), '|' "
        "order by conrelid::regclass::text, conname collate \"C\")), '-') from pg_constraint where connamespace = 'public'::regnamespace"
    ),
    "sequences": (
        "select count(*), coalesce(md5(string_agg(sequencename || ':' || coalesce(last_value::text, '-'), '|' "
        "order by sequencename collate \"C\")), '-') from pg_sequences where schemaname = 'public'"
    ),
}


class Fail(Exception):
    """A problem to report in one line (never containing the address or the password)."""


def read_url():
    url = os.environ.get("BACKUP_DATABASE_URL")
    if url is None:
        env_file = REPO / "backend" / ".env"
        if env_file.exists():
            for line in env_file.read_text(encoding="utf-8").splitlines():
                if line.startswith("BACKUP_DATABASE_URL="):
                    url = line.split("=", 1)[1]
    if not url or not url.strip():
        raise Fail("BACKUP_DATABASE_URL is not set (environment or backend/.env).")
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
        raise Fail("BACKUP_DATABASE_URL must look like postgresql://user:password@host:5432/database?sslmode=require.")
    name = unquote(parts.path.lstrip("/"))
    if not name:
        raise Fail("BACKUP_DATABASE_URL needs a database name after the host.")
    return {
        "PGHOST": parts.hostname,
        "PGPORT": str(port),
        "PGUSER": unquote(parts.username),
        "PGPASSWORD": unquote(parts.password),
        "PGDATABASE": name,
        "PGSSLMODE": (options.get("sslmode") or ["require"])[-1],
    }


def scrub(text, secrets):
    """`text` with every secret replaced by ***."""
    for secret in secrets:
        if secret:
            text = text.replace(secret, "***")
    return text


class Source:
    """The database being backed up, and the way to run things against it inside the container."""

    def __init__(self, url, container=CONTAINER):
        self.container = container
        self.env = parse_source(url)
        self.secrets = [self.env["PGPASSWORD"], url]

    def exec_args(self, argv, *, interactive=False):
        names = []
        for name in (*PG_VARS, "PGTZ"):
            names += ["-e", name]
        return ["docker", "exec", *(["-i"] if interactive else []), *names, self.container, *argv]

    def environ(self):
        return {**os.environ, **self.env, "PGTZ": "UTC"}


def run(args, *, env=None, stdin=None, stdout=None, secrets=()):
    result = subprocess.run(args, env=env, stdin=stdin, stdout=stdout if stdout else subprocess.PIPE, stderr=subprocess.PIPE)
    out = b"" if stdout else result.stdout
    return result.returncode, out.decode("utf-8", "replace").strip(), scrub(result.stderr.decode("utf-8", "replace").strip(), secrets)[:300]


def query(source, side, sql, copy):
    """One query on the source or on the local copy (inside the container); returns the last line of output."""
    if side == "source":
        code, out, err = run(source.exec_args(["sh", "-c", 'psql -Atc "$1"', "sh", sql]), env=source.environ(), secrets=source.secrets)
    else:
        code, out, err = run(["docker", "exec", "-e", "PGTZ=UTC", source.container, "sh", "-c", f'psql -U "$POSTGRES_USER" -d {copy} -Atc "$1"', "sh", sql])
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
    if REPO in (path, *path.parents):
        raise Fail(f"{path} is inside this repository: a dump holds every row, so put it somewhere else.")
    if path.exists():
        raise Fail(f"{path} already exists: not overwriting it.")
    if not path.parent.is_dir():
        raise Fail(f"{path.parent} does not exist.")
    command = source.exec_args(["sh", "-c", "pg_dump -n public -Fc --no-owner --no-acl"])
    with open(path, "wb") as handle:
        code, _, err = run(command, env=source.environ(), stdout=handle, secrets=source.secrets)
    if code != 0:
        path.unlink(missing_ok=True)  # our own half-written file: a partial dump must not look like a backup
        raise Fail(f"pg_dump failed: {err or 'no message'}")
    print(f"dump written: {path} ({path.stat().st_size} bytes)")
    print("It holds every row, including password hashes and live session keys: treat it like a password.")


def check(source, dump, copy):
    path = Path(dump).expanduser().resolve()
    if not path.is_file():
        raise Fail(f"{path} is not a file.")
    exists = local(f"select count(*) from pg_database where datname = '{copy}'")
    if exists != "0":
        tables = local("select count(*) from information_schema.tables where table_schema not in ('pg_catalog', 'information_schema')", copy)
        if tables != "0":
            raise Fail(f"{copy} already exists and holds {tables} table(s): not touching it. Use another name.")
        print(f"reusing the empty {copy}")
    else:
        local(f"CREATE DATABASE {copy}")
        print(f"created {copy}")
    local("DROP SCHEMA public", copy)  # a new database has an empty one; the dump creates it. No CASCADE: it must be empty.
    with open(path, "rb") as handle:
        code, _, err = run(
            ["docker", "exec", "-i", source.container, "sh", "-c", f'pg_restore -U "$POSTGRES_USER" -d {copy} --no-owner --no-acl --exit-on-error'],
            stdin=handle,
        )
    if code != 0:
        raise Fail(f"pg_restore failed: {err or 'no message'}")
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
        a, b = query(source, "source", sql, copy), None
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
        if not args.copy.replace("_", "").isalnum() if args.command == "check" else False:
            raise Fail("the copy's name may contain only letters, digits and underscores.")
        source = Source(read_url())
        if args.command == "backup":
            backup(source, args.file)
            return 0
        return check(source, args.file, args.copy)
    except Fail as exc:
        print(f"FAILED: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
