/**
 * English: the default language and the master list of keys (#71). Azerbaijani (az.ts) must have
 * exactly the same keys; the type and a test both check it. `{name}` marks a value filled in at
 * run time. What a person typed (questions, answers, drafts) is never put through here.
 */
export const en = {
  "lang.label": "Language",

  "nav.home": "Sual-Cavab, home",

  "status.open": "Open",
  "status.asked": "Asked",
  "status.answered": "Answered",
  "status.dropped": "Dropped",

  "waking": "The site may be waking up after being idle. This can take up to two minutes.",

  "session.checking": "Checking your session…",
  "session.signedInAs": "Signed in as {who}.",
  "session.yourProjects": "Your projects",
  "session.signOut": "Sign out",
  "session.signIn": "Sign in",
  "session.signOutFailed": "Sign-out failed. You are still signed in.",
  "error.server": "Could not reach the server.",

  "login.eyebrow": "Access",
  "login.title": "Sign in",
  "login.note": "Accounts are created by an administrator.",
  "login.email": "Email",
  "login.password": "Password",
  "login.submit": "Sign in",
  "login.submitting": "Signing in…",
  "login.tooMany": "Too many attempts. Wait a minute and try again.",
  "login.incorrect": "Email or password is incorrect.",
  "login.failed": "Sign-in failed. Try again.",

  "workspace.projects": "Projects",
  "workspace.loading": "Loading project…",
  "workspace.notFound": "Project not found.",
  "workspace.back": "Back to your projects",
  "workspace.loadError": "Could not load the project.",
  "workspace.members": "Members and details",
  "workspace.filterGroup": "Filter questions",
  "workspace.all": "All",
  "workspace.pick": "Pick {label}",
  "workspace.none": "No questions yet. Add the first one.",
  "workspace.noneWithStatus": "No questions with this status.",
  "workspace.selectPrompt": "Select a question to see why it matters, what it blocks and its answer.",
  "workspace.selected": "Selected question",
  "workspace.add": "Add a question",

  "question.why": "Why it matters: {text}",
  "question.blocks": "Blocks: {text}",
  "question.answer": "Answer",
  "question.earlier": "Earlier answer",
  "question.by": "by {who}",
  "question.edit": "Edit",
  "question.save": "Save",
  "question.saving": "Saving…",
  "question.cancel": "Cancel",

  "transition.markAsked": "Mark asked",
  "transition.recordAnswer": "Record answer",
  "transition.drop": "Drop",
  "transition.unask": "Un-ask",
  "transition.reopen": "Re-open",
  "transition.restore": "Restore",

  "form.question": "Question",
  "form.why": "Why it matters",
  "form.blocks": "What it blocks",
  "form.add": "Add question",
  "form.adding": "Adding…",

  "answer.text": "Answer",
  "answer.by": "Answered by",
  "answer.date": "Date",
  "answer.where": "Where",
  "answer.note": "Note (optional)",
  "answer.save": "Save answer",
  "channel.chat": "Chat",
  "channel.meeting": "Meeting",
  "channel.email": "Email",
  "channel.other": "Other",

  "error.addQuestion": "Could not add the question.",
  "error.changeStatus": "Could not change the status.",
  "error.saveQuestion": "Could not save the question.",

  "draft.heading": "Draft a message",
  "draft.tickPrompt": "Tick up to {max} open or asked questions.",
  "draft.tickedOne": "1 question ticked: {list}.",
  "draft.tickedMany": "{n} questions ticked: {list}.",
  "draft.notice":
    "The text of the selected questions (the question, why it matters and what it blocks) is sent to Claude to write the draft. Nothing else about the project or the client is sent. The app never sends the message anywhere: you copy it and send it yourself.",
  "draft.write": "Write a draft",
  "draft.writing": "Writing…",
  "draft.rewrite": "Write a new draft (replaces the one below)",
  "draft.label": "Draft (edit it before you send it)",
  "draft.stale": "The ticked questions have changed since this draft was written.",
  "draft.copy": "Copy",
  "draft.copied": "Copied.",
  "draft.copyFailed": "Could not copy. Select the text and copy it yourself.",
  "draft.notSent": "Nothing has been sent. This draft is not saved: copy it before you leave the page.",
} as const;

export type Key = keyof typeof en;
