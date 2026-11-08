"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import QuestionsManager from "./QuestionsManager";

export default function QuestionsScreen() {
  const { id } = useParams<{ id: string }>();
  return (
    <>
      <p>
        <Link href={`/projects/${id}`}>Back to the project</Link>
      </p>
      <h1>Questions</h1>
      <QuestionsManager key={id} projectId={id} />
    </>
  );
}
