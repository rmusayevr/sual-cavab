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
      expect(screen.getByRole("button", { name: "Çıxar: max@example.invalid" })).toBeInTheDocument();
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

  describe("review of #108", () => {
    const named = member(3, "new@example.invalid", "member", "Nora Newcomer");
    const me = (id: number) => (c: Call) =>
      c.url === "/api/auth/me/" ? json(200, { id, email: "olga@example.invalid", name: "Olga Owner" }) : undefined;

    it("asks differently when the person is removing themselves, and goes to the projects list at once", async () => {
      const calls = api((c) => me(1)(c) ?? (c.method === "DELETE" ? new Response(null, { status: 204 }) : undefined));
      open();
      await waitFor(() => expect(calls.some((c) => c.url === "/api/auth/me/")).toBe(true));

      fireEvent.click(screen.getByRole("button", { name: "Remove Olga Owner" }));

      expect(await screen.findByText(/Remove yourself from this project\? You will lose access/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));
      await waitFor(() => expect(push).toHaveBeenCalledWith("/projects"));
      expect(calls.filter((c) => c.method === "GET" && c.url === "/api/projects/5/members/")).toHaveLength(0);
    });

    it("asks about the other person by name when it is not them", async () => {
      const calls = api((c) => me(1)(c));
      open();
      await waitFor(() => expect(calls.some((c) => c.url === "/api/auth/me/")).toBe(true));

      fireEvent.click(screen.getByRole("button", { name: "Remove max@example.invalid" }));

      expect(screen.getByText("Remove max@example.invalid from this project?")).toBeInTheDocument();
      expect(screen.queryByText(/Remove yourself/)).not.toBeInTheDocument();
    });

    it("puts the keyboard on Cancel when the question opens, and back on Remove after Cancel", () => {
      api(() => undefined);
      open();

      fireEvent.click(screen.getByRole("button", { name: "Remove max@example.invalid" }));
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
      expect(screen.getByRole("group", { name: "Remove max@example.invalid from this project?" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.getByRole("button", { name: "Remove max@example.invalid" })).toHaveFocus();
    });

    it("shows a 403 on add above the form", async () => {
      api((c) => (c.method === "POST" ? json(403, { detail: "Only an owner can add members." }) : undefined));
      open();

      fill("new@example.invalid");

      expect(await screen.findByRole("alert")).toHaveTextContent("Only an owner can add members.");
    });

    it("reads the list again, and so leaves the project, when an add finds the project gone (404)", async () => {
      api((c) => {
        if (c.method === "POST") return json(404, { detail: "No Project matches the given query." });
        if (c.method === "GET") return json(404, { detail: "Not found." });
      });
      open();

      fill("new@example.invalid");

      await waitFor(() => expect(push).toHaveBeenCalledWith("/projects"));
    });

    it("names the new member by name in the notice, and shows them at once even if the read afterwards fails", async () => {
      api((c) => {
        if (c.method === "POST") return json(201, named);
        if (c.method === "GET") return json(500, {});
      });
      const onMembers = open();

      fill("new@example.invalid");

      expect(await screen.findByText("Nora Newcomer was added.")).toBeInTheDocument();
      expect(onMembers).toHaveBeenCalledWith([OWNER, MEMBER, named]);
    });

    it("names the removed member by name in the notice", async () => {
      const bob = member(4, "bob@example.invalid", "member", "Bob Builder");
      api((c) => (c.method === "DELETE" ? new Response(null, { status: 204 }) : undefined), [OWNER]);
      open(vi.fn(), [OWNER, bob]);

      fireEvent.click(screen.getByRole("button", { name: "Remove Bob Builder" }));
      fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));

      expect(await screen.findByText("Bob Builder was removed.")).toBeInTheDocument();
    });

    it("announces the outcome in a status region", async () => {
      api((c) => (c.method === "POST" ? json(201, named) : undefined));
      open();

      fill("new@example.invalid");

      await screen.findByText("Nora Newcomer was added.");
      expect(screen.getByText("Nora Newcomer was added.")).toHaveAttribute("role", "status");
    });

    it("resets the role to member after an add", async () => {
      api((c) => (c.method === "POST" ? json(201, member(3, "o2@example.invalid", "owner")) : undefined));
      open();

      fill("o2@example.invalid", "owner");

      await screen.findByText("o2@example.invalid was added.");
      expect(screen.getByLabelText("Role")).toHaveValue("member");
    });

    it("shows a role error by the Role field", async () => {
      api((c) => (c.method === "POST" ? json(400, { role: ["That is not a valid choice."] }) : undefined));
      open();

      fill("new@example.invalid");

      await screen.findByText("That is not a valid choice.");
      expect(screen.getByLabelText("Role")).toHaveAttribute("aria-invalid", "true");
    });

    it("clears the last add's errors when the next add is sent", async () => {
      let first = true;
      api((c) => {
        if (c.method !== "POST") return undefined;
        if (first) {
          first = false;
          return json(400, { email: ["This user is already a member."] });
        }
        return json(201, named);
      });
      open();
      fill("max@example.invalid");
      await screen.findByText("This user is already a member.");

      fill("new@example.invalid");

      await screen.findByText("Nora Newcomer was added.");
      expect(screen.queryByText("This user is already a member.")).not.toBeInTheDocument();
    });

    it("clears the last message when Remove is pressed again", async () => {
      api((c) => (c.method === "DELETE" ? json(400, { detail: "A project needs at least one active owner." }) : undefined));
      open();
      fireEvent.click(screen.getByRole("button", { name: "Remove Olga Owner" }));
      fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));
      await screen.findByRole("alert");

      fireEvent.click(screen.getByRole("button", { name: "Remove max@example.invalid" }));

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("says the server could not be reached when removing, and keeps the list", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          if (url === "/api/auth/csrf/") return new Response(null, { status: 204 });
          if (init?.method === "DELETE") throw new Error("offline");
          return json(200, [OWNER, MEMBER]);
        }),
      );
      const onMembers = open();
      fireEvent.click(screen.getByRole("button", { name: "Remove max@example.invalid" }));

      fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server.");
      expect(onMembers).not.toHaveBeenCalled();
    });

    it("does not leave the project because of a server error on the read after a change", async () => {
      api((c) => {
        if (c.method === "DELETE") return new Response(null, { status: 204 });
        if (c.method === "GET") return json(500, {});
      });
      open();
      fireEvent.click(screen.getByRole("button", { name: "Remove max@example.invalid" }));

      fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));

      await screen.findByText("max@example.invalid was removed.");
      expect(push).not.toHaveBeenCalled();
    });

    it("cannot be pressed twice while a removal is on its way, nor can the other Remove buttons", async () => {
      let release: (r: Response) => void = () => {};
      const calls: Call[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string, init?: RequestInit) => {
          calls.push({ method: init?.method ?? "GET", url });
          if (url === "/api/auth/csrf/") return Promise.resolve(new Response(null, { status: 204 }));
          if (init?.method === "DELETE") return new Promise<Response>((resolve) => (release = resolve));
          return Promise.resolve(json(200, [OWNER]));
        }),
      );
      open();
      fireEvent.click(screen.getByRole("button", { name: "Remove max@example.invalid" }));

      fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));

      expect(await screen.findByRole("button", { name: "Removing…" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Remove Olga Owner" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Removing…" }));
      release(new Response(null, { status: 204 }));
      await screen.findByText("max@example.invalid was removed.");
      expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
    });

    it("cannot be sent twice while an add is on its way, and the email cannot be edited meanwhile", async () => {
      let release: (r: Response) => void = () => {};
      const calls: Call[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string, init?: RequestInit) => {
          calls.push({ method: init?.method ?? "GET", url });
          if (url === "/api/auth/csrf/") return Promise.resolve(new Response(null, { status: 204 }));
          if (init?.method === "POST") return new Promise<Response>((resolve) => (release = resolve));
          return Promise.resolve(json(200, [OWNER, MEMBER]));
        }),
      );
      open();

      fill("new@example.invalid");

      const sending = await screen.findByRole("button", { name: "Adding…" });
      expect(sending).toBeDisabled();
      expect(screen.getByLabelText("Email")).toBeDisabled();
      fireEvent.click(sending);
      release(json(201, named));
      await screen.findByText("Nora Newcomer was added.");
      expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    });
  });
});
