import { ApiError, getNote } from "@/lib/api";
import { NoteContent } from "./note-content";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function SlugPage({ params }: PageProps) {
  const { slug } = await params;
  return <NoteContent slug={slug} />;
}
