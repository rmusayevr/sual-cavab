import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { cx } from "@/lib/cx";

import { Alert } from "./Alert";
import { Button } from "./Button";
import { Card } from "./Card";
import { Field, Input, Textarea } from "./Field";
import { PageShell } from "./PageShell";
import { StatusChip, type QuestionStatus } from "./StatusChip";

describe("cx", () => {
  it("joins class names and skips empty ones", () => {
    expect(cx("a", false, null, undefined, "", "b")).toBe("a b");
  });
});

describe("Button", () => {
  it("is a plain button by default, so it never submits a form by accident", () => {
    render(<Button>Save</Button>);

    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("type", "button");
  });

  it("can submit when asked to", () => {
    render(<Button type="submit">Send</Button>);

    expect(screen.getByRole("button", { name: "Send" })).toHaveAttribute("type", "submit");
  });

  it("is at least 44 px tall, so it can be tapped on a phone", () => {
    render(<Button>Tap</Button>);

    expect(screen.getByRole("button")).toHaveClass("min-h-11");
  });

  it("looks different for each variant", () => {
    render(
      <>
        <Button variant="primary">One</Button>
        <Button variant="secondary">Two</Button>
        <Button variant="danger">Three</Button>
      </>,
    );
    const classes = ["One", "Two", "Three"].map((name) => screen.getByRole("button", { name }).className);

    expect(new Set(classes).size).toBe(3);
  });

  it("can be disabled and keeps a caller's own classes", () => {
    render(
      <Button disabled className="w-full">
        Wait
      </Button>,
    );

    expect(screen.getByRole("button", { name: "Wait" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Wait" })).toHaveClass("w-full");
  });
});

describe("Field", () => {
  it("ties the label to its control", () => {
    render(<Field label="Email">{(props) => <Input type="email" {...props} />}</Field>);

    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
  });

  it("points the control at its hint and its error, and marks it invalid on an error", () => {
    render(
      <Field label="Question" hint="Keep it short" error="Text is required">
        {(props) => <Textarea {...props} />}
      </Field>,
    );
    const control = screen.getByLabelText("Question");

    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAccessibleDescription("Keep it short Text is required");
  });

  it("is not marked invalid, and describes nothing, without a hint or an error", () => {
    render(<Field label="Name">{(props) => <Input {...props} />}</Field>);
    const control = screen.getByLabelText("Name");

    expect(control).not.toHaveAttribute("aria-invalid");
    expect(control).not.toHaveAttribute("aria-describedby");
  });

  it("gives two fields their own ids", () => {
    render(
      <>
        <Field label="First">{(props) => <Input {...props} />}</Field>
        <Field label="Second">{(props) => <Input {...props} />}</Field>
      </>,
    );

    expect(screen.getByLabelText("First").id).not.toBe(screen.getByLabelText("Second").id);
  });
});

describe("StatusChip", () => {
  const all: QuestionStatus[] = ["open", "asked", "answered", "dropped"];

  it("always shows the status as a word", () => {
    render(
      <>
        {all.map((status) => (
          <StatusChip key={status} status={status} />
        ))}
      </>,
    );

    for (const word of ["Open", "Asked", "Answered", "Dropped"]) expect(screen.getByText(word)).toBeInTheDocument();
  });

  it("gives each status its own colours", () => {
    render(
      <>
        {all.map((status) => (
          <StatusChip key={status} status={status} />
        ))}
      </>,
    );
    const classes = ["Open", "Asked", "Answered", "Dropped"].map((word) => screen.getByText(word).className);

    expect(new Set(classes).size).toBe(4);
  });
});

describe("Alert", () => {
  it("announces an error at once", () => {
    render(<Alert tone="error">Could not save</Alert>);

    expect(screen.getByRole("alert")).toHaveTextContent("Could not save");
  });

  it("announces information politely", () => {
    render(<Alert>Saved</Alert>);

    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Card and PageShell", () => {
  it("a card shows what it holds", () => {
    render(<Card>Inside</Card>);

    expect(screen.getByText("Inside")).toBeInTheDocument();
  });

  it("a page has one main area, and a heading when it has a title", () => {
    render(<PageShell title="Projects">List</PageShell>);

    expect(screen.getByRole("main")).toHaveTextContent("List");
    expect(screen.getByRole("heading", { level: 1, name: "Projects" })).toBeInTheDocument();
  });

  it("a page without a title has no heading", () => {
    render(<PageShell>List</PageShell>);

    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});
