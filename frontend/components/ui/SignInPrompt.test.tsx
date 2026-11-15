import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SignInPrompt } from "./SignInPrompt";

const path = vi.hoisted(() => ({ now: "/projects/5" as string | null }));
vi.mock("next/navigation", () => ({ usePathname: () => path.now }));

describe("SignInPrompt (#96)", () => {
  beforeEach(() => {
    path.now = "/projects/5";
  });

  it("sends the person to sign in and back to the page they were on", () => {
    render(<SignInPrompt line="workspace.signInLine" />);

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Fprojects%2F5");
  });

  it("links to plain sign-in when the page is not known", () => {
    path.now = null;

    render(<SignInPrompt line="workspace.signInLine" />);

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });
});
