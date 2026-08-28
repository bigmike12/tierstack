import type { Block, Method } from "@/docs/types";

/**
 * The one renderer every documentation page goes through.
 *
 * Inline code is written with backticks in the content file and split here
 * rather than parsed as HTML — there is no markdown pipeline and no
 * dangerouslySetInnerHTML, so a stray character in the docs can never become
 * markup on the page.
 */
function inline(text: string, keyPrefix: string) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={key}
          className="rounded border border-line bg-white/70 px-1.5 py-0.5 font-mono text-[0.86em]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={key} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={key}>{part}</span>;
  });
}

const METHOD_TONE: Record<Method, string> = {
  GET: "text-settled border-settled/40",
  POST: "text-accent border-accent/40",
  PATCH: "text-pending border-pending/40",
  PUT: "text-pending border-pending/40",
  DELETE: "text-[#93382A] border-[#93382A]/40",
};

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <div className="flex flex-col gap-6">
      {blocks.map((block, index) => {
        const key = `block-${index}`;

        switch (block.kind) {
          case "heading":
            return (
              <h2 key={key} className="mt-6 text-balance text-2xl font-semibold tracking-tight">
                {block.text}
              </h2>
            );

          case "prose":
            return (
              <p key={key} className="max-w-readable text-[17px] leading-relaxed text-muted">
                {inline(block.text, key)}
              </p>
            );

          case "list":
            return (
              <ul key={key} className="max-w-readable space-y-2.5">
                {block.items.map((item, itemIndex) => (
                  <li key={item} className="flex gap-3 leading-relaxed text-muted">
                    <span aria-hidden className="mt-[10px] size-1.5 shrink-0 rounded-full bg-line" />
                    <span>{inline(item, `${key}-${itemIndex}`)}</span>
                  </li>
                ))}
              </ul>
            );

          case "code":
            return (
              <figure key={key} className="m-0">
                {block.caption ? (
                  <figcaption className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                    {block.caption}
                  </figcaption>
                ) : null}
                <div className="overflow-x-auto rounded-xl bg-ink p-6 text-paper">
                  <pre className="font-mono text-[12.5px] leading-relaxed">
                    <code>{block.code}</code>
                  </pre>
                </div>
              </figure>
            );

          case "endpoint":
            return (
              <div
                key={key}
                className="flex flex-col gap-1.5 border-t border-line pt-3 sm:flex-row sm:items-baseline sm:gap-4"
              >
                <span
                  className={`inline-flex w-fit shrink-0 rounded border px-2 py-0.5 font-mono text-[11px] tracking-[0.1em] ${METHOD_TONE[block.method]}`}
                >
                  {block.method}
                </span>
                <span className="font-mono text-[13.5px] text-ink">{block.path}</span>
                {block.summary ? (
                  <span className="text-[14px] leading-relaxed text-muted sm:ml-auto sm:max-w-[38ch] sm:text-right">
                    {inline(block.summary, `${key}-summary`)}
                  </span>
                ) : null}
              </div>
            );

          case "params":
            return (
              <div key={key}>
                {block.title ? (
                  <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
                    {block.title}
                  </p>
                ) : null}
                <dl className="grid gap-0 border-t border-line">
                  {block.rows.map((row) => (
                    <div
                      key={row.name}
                      className="grid gap-1 border-b border-line py-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:gap-6"
                    >
                      <dt className="flex flex-wrap items-baseline gap-2">
                        <span className="font-mono text-[13px] text-ink">{row.name}</span>
                        <span className="font-mono text-[11px] text-muted">{row.type}</span>
                        {row.required ? (
                          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-accent">
                            required
                          </span>
                        ) : null}
                      </dt>
                      <dd className="m-0 text-[15px] leading-relaxed text-muted">
                        {inline(row.note, `${key}-${row.name}`)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            );

          case "table":
            return (
              <div key={key} className="overflow-x-auto">
                <table className="w-full min-w-[32rem] border-collapse text-[15px]">
                  <thead>
                    <tr>
                      {block.head.map((cell) => (
                        <th
                          key={cell}
                          className="border-b border-ink pb-2.5 text-left font-mono text-[11px] font-normal uppercase tracking-[0.14em] text-muted"
                        >
                          {cell}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={row.join("|")}>
                        {row.map((cell, cellIndex) => (
                          <td
                            key={`${rowIndex}-${cellIndex}`}
                            className={`border-b border-line py-2.5 pr-6 align-top leading-relaxed last:pr-0 ${
                              cellIndex === 0 ? "text-ink" : "text-muted"
                            }`}
                          >
                            {inline(cell, `${key}-${rowIndex}-${cellIndex}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          case "note":
            return (
              <aside
                key={key}
                className={`max-w-readable border-l-2 py-1 pl-5 text-[15px] leading-relaxed text-muted ${
                  block.tone === "warn" ? "border-accent" : "border-line"
                }`}
              >
                {inline(block.text, key)}
              </aside>
            );

          default:
            return null;
        }
      })}
    </div>
  );
}
