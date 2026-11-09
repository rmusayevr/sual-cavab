"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import QuestionsManager from "./QuestionsManager";
import { buttonClasses } from "./ui/Button";

export default function QuestionsScreen() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="grid gap-4">
      <div>
        <Link href={`/projects/${id}`} className={buttonClasses("secondary")}>
          Back to the project
        </Link>
      </div>
      <h1 className="text-2xl font-semibold">Questions</h1>
      <QuestionsManager key={id} projectId={id} />
    </div>
  );
}
