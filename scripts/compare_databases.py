"""Compare a database with its restored copy, table by table (#35): the evidence that a backup restores.

Run it after restoring a dump into a new database in the local Docker database container (README, "Backups and
restore"). For every table of the `public` schema it prints the number of rows and a checksum of their contents on
both sides; it exits 0 only if the two lists of tables and every checksum are the same.

Needs Docker with the project's database container up, and the address of the database that was backed up in the
environment variable BACKUP_DATABASE_URL (it holds the password: never put it on the command line, in a file in the
repository, or in a chat). Both databases are only read.

Usage: BACKUP_DATABASE_URL=... python scripts/compare_databases.py [copy_database_name] [container_name]
       (defaults: restore_check, sual-cavab-db-1)

The checksum does not depend on the server's sort order or time zone: rows are ordered as text in the "C" collation
and the session time zone is UTC. (Comparing without that showed false differences between two servers.)
"""

import os
import subprocess
import sys

COPY = sys.argv[1] if len(sys.argv) > 1 else "restore_check"
CONTAINER = sys.argv[2] if len(sys.argv) > 2 else "sual-cavab-db-1"
LIST_TABLES = "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1"


def psql(side, sql):
    """Run one query on 'source' (the backed-up database) or 'copy' (inside the container); return (code, output)."""
    if side == "source":
        command = ["docker", "exec", "-e", "BACKUP_DATABASE_URL", CONTAINER, "sh", "-c", 'psql "$BACKUP_DATABASE_URL" -Atc "$1"', "sh", sql]
    else:
        command = ["docker", "exec", CONTAINER, "sh", "-c", f'psql -U "$POSTGRES_USER" -d {COPY} -Atc "$1"', "sh", sql]
    result = subprocess.run(command, capture_output=True)
    output = result.stdout.decode("utf-8", "replace").strip()
    return result.returncode, output or result.stderr.decode("utf-8", "replace").strip()[:120].replace(os.environ.get("BACKUP_DATABASE_URL", "\0"), "<url>")


def fingerprint(side, table):
    sql = (
        "set timezone to 'UTC'; select count(*), coalesce(md5(string_agg(t::text, chr(124) order by t::text collate \"C\")), chr(45)) "
        f'from public."{table}" t'
    )
    code, output = psql(side, sql)
    return output.splitlines()[-1] if code == 0 and output else "ERROR " + output


def main():
    if not os.environ.get("BACKUP_DATABASE_URL"):
        sys.exit("BACKUP_DATABASE_URL is not set (the address of the database that was backed up).")
    code_s, source = psql("source", LIST_TABLES)
    code_c, copy = psql("copy", LIST_TABLES)
    if code_s or code_c:
        sys.exit(f"Could not list the tables: source {'ok' if not code_s else source}, copy {'ok' if not code_c else copy}.")
    source_tables, copy_tables = source.splitlines(), copy.splitlines()
    print(f"tables: {len(source_tables)} in the source, {len(copy_tables)} in {COPY}")
    different = 0 if source_tables == copy_tables else 1
    for table in source_tables:
        a, b = fingerprint("source", table), fingerprint("copy", table)
        same = a == b and not a.startswith("ERROR")
        different += 0 if same else 1
        rows, _, checksum = a.partition("|")
        print(f"{'same' if same else 'DIFF'} {table:<34} {rows:>6} rows  {checksum[:8]}" + ("" if same else f"  (copy: {b[:60]})"))
    print(f"differences: {different}")
    sys.exit(0 if different == 0 else 1)


if __name__ == "__main__":
    main()
