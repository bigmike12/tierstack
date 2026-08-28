import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Blocks } from "@/components/docs";
import { ALL_PAGES, findPage, neighbours } from "@/docs/content";

export function generateStaticParams() {
  return ALL_PAGES.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = findPage(slug);
  if (!page) return {};
  return { title: page.title, description: page.summary };
}

export default async function DocPageView({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = findPage(slug);
  if (!page) notFound();

  const { previous, next } = neighbours(slug);

  return (
    <article>
      <h1 className="text-balance text-[2rem] font-semibold leading-[1.1] tracking-tightest sm:text-[2.4rem]">
        {page.title}
      </h1>
      <p className="mt-4 max-w-readable text-lg leading-relaxed text-muted">{page.summary}</p>

      <div className="mt-12">
        <Blocks blocks={page.blocks} />
      </div>

      <nav
        aria-label="Pagination"
        className="mt-16 grid gap-4 border-t border-line pt-6 sm:grid-cols-2"
      >
        {previous ? (
          <Link href={`/docs/${previous.slug}`} className="group">
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
              Previous
            </span>
            <span className="mt-1 block font-medium group-hover:opacity-70">{previous.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={`/docs/${next.slug}`} className="group sm:text-right">
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Next</span>
            <span className="mt-1 block font-medium group-hover:opacity-70">{next.title}</span>
          </Link>
        ) : null}
      </nav>
    </article>
  );
}
