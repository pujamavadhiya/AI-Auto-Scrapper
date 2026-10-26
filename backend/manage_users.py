#!/usr/bin/env python3
"""
CLI Utility to manage application users and their isolated API keys.
Usage examples:
    python backend/manage_users.py create --email user@example.com --password secret123 --name "Jane Doe"
    python backend/manage_users.py create (interactive prompt)
    python backend/manage_users.py list
    python backend/manage_users.py set-keys --email user@example.com --serpapi "06f4..."
    python backend/manage_users.py change-password --email user@example.com --password newsecret
    python backend/manage_users.py delete --email user@example.com
"""

import sys
import argparse
import getpass
from pathlib import Path

# Add backend directory to sys.path
BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import database


def cmd_create(args):
    email = args.email
    password = args.password
    name = args.name or ""
    role = args.role or "user"

    if not email:
        email = input("User Email: ").strip()
    if not password:
        password = getpass.getpass("Password (min 6 chars): ").strip()
        confirm = getpass.getpass("Confirm Password: ").strip()
        if password != confirm:
            print("❌ Passwords do not match.")
            sys.exit(1)
    if not name and not args.non_interactive:
        name = input("Display Name (optional): ").strip()

    try:
        user = database.create_user(email=email, password=password, name=name, role=role)
        print("\n✅ User created successfully!")
        print(f"   ID:    {user['id']}")
        print(f"   Email: {user['email']}")
        print(f"   Name:  {user['name'] or '(none)'}")
        print(f"   Role:  {user['role']}")
        print("\nThe user can now log into the web application using this email and password.")
        print("Each user configures their own SerpAPI, Serper, and Gemini keys via Platform Settings.")
    except Exception as e:
        print(f"❌ Error creating user: {e}")
        sys.exit(1)


def cmd_list(args):
    users = database.list_users()
    if not users:
        print("No users found in database. Create one using:")
        print("  python backend/manage_users.py create --email <email> --password <pwd>")
        return

    print("\n" + "=" * 80)
    print(f"{'Email':<30} | {'Name':<15} | {'SerpAPI':<8} | {'Serper':<8} | {'Gemini':<8} | {'LeadOcean':<9}")
    print("=" * 80)
    for u in users:
        serp = "✅ Set" if u.get("has_serpapi_key") else "❌ Missing"
        serper = "✅ Set" if u.get("has_serper_key") else "❌ Missing"
        gemini = "✅ Set" if u.get("has_gemini_key") else "❌ Missing"
        leadocean = "✅ Set" if u.get("has_leadocean_key") else "❌ Missing"
        print(f"{u['email']:<30} | {(u['name'] or '-'):<15} | {serp:<8} | {serper:<8} | {gemini:<8} | {leadocean:<9}")
    print("=" * 80)
    print(f"Total Users: {len(users)}\n")


def cmd_set_keys(args):
    email = args.email
    if not email:
        email = input("User Email: ").strip()

    # Find user
    users = database.list_users()
    matched = [u for u in users if u["email"].lower() == email.lower()]
    if not matched:
        print(f"❌ User not found with email '{email}'.")
        sys.exit(1)

    user_id = matched[0]["id"]
    keys_to_update = {}
    if args.serpapi:
        keys_to_update["serpapi_key"] = args.serpapi
    if args.serper:
        keys_to_update["serper_key"] = args.serper
    if args.gemini:
        keys_to_update["gemini_api_key"] = args.gemini
    if args.leadocean:
        keys_to_update["leadocean_api_key"] = args.leadocean

    if not keys_to_update:
        print("No keys specified to update. Use flags: --serpapi, --serper, --gemini, --leadocean")
        return

    database.update_user_keys(user_id, keys_to_update)
    print(f"✅ Successfully updated keys for user {email}!")


def cmd_change_password(args):
    email = args.email or input("User Email: ").strip()
    password = args.password or getpass.getpass("New Password: ").strip()

    try:
        if database.update_user_password(email, password):
            print(f"✅ Password for {email} updated successfully.")
        else:
            print(f"❌ User '{email}' not found.")
    except Exception as e:
        print(f"❌ Error updating password: {e}")


def cmd_delete(args):
    email = args.email or input("User Email to delete: ").strip()
    confirm = input(f"Are you sure you want to delete user '{email}' and their keys? (y/N): ").strip().lower()
    if confirm == "y":
        if database.delete_user(email):
            print(f"✅ User '{email}' deleted successfully.")
        else:
            print(f"❌ User '{email}' not found.")
    else:
        print("Cancelled.")


def main():
    parser = argparse.ArgumentParser(description="AI Auto Scrapper User & Key Management CLI")
    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # create
    p_create = subparsers.add_parser("create", help="Create a new user")
    p_create.add_argument("--email", "-e", help="User email address")
    p_create.add_argument("--password", "-p", help="User password (min 6 characters)")
    p_create.add_argument("--name", "-n", help="User display name")
    p_create.add_argument("--role", "-r", default="user", help="User role (default: user)")
    p_create.add_argument("--non-interactive", action="store_true", help="Don't prompt for missing optional fields")

    # list
    subparsers.add_parser("list", help="List all registered users")

    # set-keys
    p_keys = subparsers.add_parser("set-keys", help="Set or update API keys for a specific user")
    p_keys.add_argument("--email", "-e", required=True, help="User email address")
    p_keys.add_argument("--serpapi", help="SerpAPI key")
    p_keys.add_argument("--serper", help="Serper.dev API key")
    p_keys.add_argument("--gemini", help="Google Gemini API key")
    p_keys.add_argument("--leadocean", help="LeadOcean API key")

    # change-password
    p_pwd = subparsers.add_parser("change-password", help="Change a user's password")
    p_pwd.add_argument("--email", "-e", help="User email address")
    p_pwd.add_argument("--password", "-p", help="New password")

    # delete
    p_del = subparsers.add_parser("delete", help="Delete a user")
    p_del.add_argument("--email", "-e", help="User email address")

    args = parser.parse_args()

    if args.command == "create":
        cmd_create(args)
    elif args.command == "list":
        cmd_list(args)
    elif args.command == "set-keys":
        cmd_set_keys(args)
    elif args.command == "change-password":
        cmd_change_password(args)
    elif args.command == "delete":
        cmd_delete(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
