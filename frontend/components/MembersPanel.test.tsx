import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLanguage } from "@/lib/i18n";

import MembersPanel from "./MembersPanel";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const member = (user_id: number, email: string, role: "owner" | "member", name = "") => ({
  user_id,
  email,
  name,
  role,
  added_at: "2026-01-01T00:00:00Z",
});
const OWNER = member(1, "olga@example.invalid", "owner", "Olga Owner");
const MEMBER = member(2, "max@example.invalid", "member");

type Call = { method: string; url: string; body?: unknown };

/** Stub the API: `reply` answers a call (members GET defaults to `list`); every call is recorded. */
function api(reply: (call: Call) => Response | undefined, list: unknown = [OWNER, MEMBER]) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const call = { method, url, body };
      calls.push(call);
      if (url === "/api/auth/csrf/") return new Response(null, { status: 204 });
      return reply(call) ?? json(200, list);
    }),
  );
  return calls;
}

function open(onMembers = vi.fn(), members = [OWNER, MEMBER]) {
  render(<MembersPanel projectId={5} members={members} onMembers={onMembers} />);
  return onMembers;
}

const fill = (email: string, role?: string) => {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  if (role) fireEvent.change(screen.getByLabelText("Role"), { target: { value: role } });
  fireEvent.click(screen.getByRole("button", { name: "Add member" }));
};

describe("MembersPanel (#33)", () => {
  beforeEach(() => push.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it("lists the members, each with a Remove button named for the person", () => {
    open();

    expect(screen.getByText("Olga Owner · owner")).toBeInTheDocument();
    expect(screen.getByText("max@example.invalid · member")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Olga Owner" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove max@example.invalid" })).toBeInTheDocument();
  });

  describe("adding", () => {
    it("sends the email and the role, says who was added, and reads the list again", async () => {
      const added = member(3, "new@example.invalid", "member");
      const calls = api((c) => (c.method === "POST" ? json(201, added) : undefined), [OWNER, MEMBER, added]);
      const onMembers = open();

      fill("new@example.invalid");

      expect(await screen.findByText("new@example.invalid was added.")).toBeInTheDocument();
      expect(calls.find((c) => c.method === "POST")).toMatchObject({
        url: "/api/projects/5/members/",
        body: { email: "new@example.invalid", role: "member" },
      });
      await waitFor(() => expect(onMembers).toHaveBeenCalledWith([OWNER, MEMBER, added]));
      expect(screen.getByLabelText("Email")).toHaveValue("");
    });

    it("can add an owner (the way to hand a project over)", async () => {
      const calls = api((c) => (c.method === "POST" ? json(201, member(3, "new@example.invalid", "owner")) : undefined));
      open();

      fill("new@example.invalid", "owner");

      await screen.findByText("new@example.invalid was added.");
      expect(calls.find((c) => c.method === "POST")?.body).toEqual({ email: "new@example.invalid", role: "owner" });
    });

    it("shows an unknown email next to the Email field, keeps what was typed, and adds nothing to the list", async () => {
      api((c) =>
        c.method === "POST" ? json(400, { email: ["No active user has this email. Ask an admin to create the account."] }) : undefined,
      );
      const onMembers = open();

      fill("nobody@example.invalid");

      const field = await screen.findByText("No active user has this email. Ask an admin to create the account.");
      expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(field.textContent!);
      expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByLabelText("Email")).toHaveValue("nobody@example.invalid");
      expect(onMembers).not.toHaveBeenCalled();
    });

    it("shows 'already a member' next to the Email field", async () => {
      api((c) => (c.method === "POST" ? json(400, { email: ["This user is already a member."] }) : undefined));
      open();

      fill("max@example.invalid");

      expect(await screen.findByText("This user is already a member.")).toBeInTheDocument();
    });

    it("shows the server's refusal above the button when it is not about a field (403, 429)", async () => {
      api((c) => (c.method === "POST" ? json(429, { detail: "Request was throttled. Expected available in 120 seconds." }) : undefined));
      open();

      fill("new@example.invalid");

      expect(await screen.findByRole("alert")).toHaveTextContent("Request was throttled. Expected available in 120 seconds.");
    });

    it("says the server could not be reached, and keeps what was typed", async () => {
      vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        if (url === "/api/auth/csrf/") return new Response(null, { status: 204 });
        throw new Error("offline");
      }));
      open();

      fill("new@example.invalid");

      expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server.");
      expect(screen.getByLabelText("Email")).toHaveValue("new@example.invalid");
    });
  });

  describe("removing", () => {
    const removeMax = () => fireEvent.click(screen.getByRole("button", { name: "Remove max@example.invalid" }));

    it("asks first, and sends nothing until the person says yes", () => {
      const calls = api(() => undefined);
      open();

      removeMax();

      expect(screen.getByText("Remove max@example.invalid from this project?")).toBeInTheDocument();
      expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
    });

    it("goes back to the list on Cancel, with nothing sent", () => {
      const calls = api(() => undefined);
      open();
      removeMax();

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.queryByText(/from this project\?/)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Remove max@example.invalid" })).toBeInTheDocument();
      expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
    });

    it("removes the person on Yes, says so, and reads the list again", async () => {
      const calls = api((c) => (c.method === "DELETE" ? new Response(null, { status: 204 }) : undefined), [OWNER]);
      const onMembers = open();
      removeMax();

      fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));

      expect(await screen.findByText("max@example.invalid was removed.")).toBeInTheDocument();
      expect(calls.find((c) => c.method === "DELETE")?.url).toBe("/api/projects/5/members/2/");
      await waitFor(() => expect(onMembers).toHaveBeenCalledWith([OWNER]));
      expect(screen.queryByText(/from this project\?/)).not.toBeInTheDocument(); // the question is closed
      expect(push).not.toHaveBeenCalled();
    });

    it("shows 'a project needs an owner' when the last owner is refused, and keeps the list", async () => {
      api((c) => (c.method === "DELETE" ? json(400, { detail: "A project needs at least one active owner." }) : undefined));
      const onMembers = open();
      fireEvent.click(screen.getByRole("button", { name: "Remove Olga Owner" }));

      fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("A project needs at least one active owner.");
      expect(onMembers).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Remove Olga Owner" })).toBeInTheDocument();
    });

    it("goes to the projects list when the owner removed themselves and the project is gone for them", async () => {
      api((c) => {
        if (c.method === "DELETE") return new Response(null, { status: 204 });
        if (c.method === "GET") return json(404, { detail: "Not found." });
      });
      open();
      fireEvent.click(screen.getByRole("button", { name: "Remove Olga Owner" }));

      fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));

      await waitFor(() => expect(push).toHaveBeenCalledWith("/projects"));
    });

    it("says 'could not remove' when the server answers with something that has no message", async () => {
      api((c) => (c.method === "DELETE" ? new Response("<html>bad gateway</html>", { status: 502 }) : undefined));
      open();
      removeMax();

      fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Could not remove the member.");
    });

    it("refreshes the list when the person was already gone (404 from the server)", async () => {
      const calls = api((c) => (c.method === "DELETE" ? json(404, { detail: "Not a member of this project." }) : undefined), [OWNER]);
      const onMembers = open();
      removeMax();

      fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Not a member of this project.");
      await waitFor(() => expect(onMembers).toHaveBeenCalledWith([OWNER]));
      expect(calls.filter((c) => c.method === "GET").length).toBeGreaterThan(0);
    });
  });

  it("speaks Azerbaijani when that language is chosen", () => {
    act(() => setLanguage("az"));
    try {
      open();

      expect(screen.getByText("Üzvləri idarə et")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Üzv əlavə et" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "max@example.invalid üzvünü çıxar" })).toBeInTheDocument();
      expect(screen.getByText("Olga Owner · sahib")).toBeInTheDocument();
    } finally {
      act(() => setLanguage("en"));
    }
  });

  it("is a closed section until opened, with the account hint inside", () => {
    open();

    const section = screen.getByText("Manage members").closest("details")!;
    expect(section).not.toHaveAttribute("open");
    expect(within(section).getByText(/The person needs an account already/)).toBeInTheDocument();
  });
});
