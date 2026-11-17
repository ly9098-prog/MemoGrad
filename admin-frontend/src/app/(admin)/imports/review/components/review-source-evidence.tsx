import type { ImportQuestionItem } from "@/lib/api/types";

type SourceProps = Pick<ImportQuestionItem, "raw_data" | "parsed_content">;

function RawText({ rawData }: { rawData: SourceProps["raw_data"] }) {
  const rd = rawData as Record<string, unknown>;
  const rawText = rd.raw_text || rd.ocr_text || rd.text || rd.stem || null;
  if (rawText && typeof rawText === "string") {
    return (
      <div className="rounded-xl border border-border/50 bg-muted/70 p-3">
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground">{rawText}</pre>
      </div>
    );
  }
  return (
    <div>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-border/50 bg-muted/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">{JSON.stringify(rawData, null, 2)}</pre>
    </div>
  );
}

function RawSource({ rawData }: { rawData: SourceProps["raw_data"] }) {
  return (
    rawData ? (
      <section className="animate-fade-up drawer-section-delay-5 section-scroll section-scroll-purple rounded-2xl border border-border/80 bg-card/90 p-5 shadow-sm transition-all hover:shadow-md">
        <details className="group">
          <summary className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold text-muted-foreground transition hover:text-foreground [&::-webkit-details-marker]:hidden">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent">
              <span className="text-xs font-bold text-accent-foreground font-display">原</span>
            </span>
            <span>OCR 原文 / 导入原始信息</span>
            <span className="ml-auto inline-block text-[10px] transition-transform group-open:rotate-90 opacity-50">▶</span>
          </summary>
          <div className="mt-3 ml-9 space-y-3">
            <RawText rawData={rawData} />
          </div>
        </details>
      </section>
    ) : (
      <section className="animate-fade-up drawer-section-delay-5 section-scroll section-scroll-purple rounded-2xl border border-border/80 bg-card/90 p-5 shadow-sm transition-all hover:shadow-md">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent">
            <span className="text-xs font-bold text-accent-foreground font-display">原</span>
          </span>
          <span className="text-sm font-semibold text-muted-foreground">OCR 原文</span>
          <span className="ml-auto text-xs text-muted-foreground/70">暂无 OCR 原文</span>
        </div>
      </section>
    )
  );
}

function SourceSnapshot({ content }: { content: SourceProps["parsed_content"] }) {
  const pc = content as Record<string, unknown> | undefined;
  const snapUrl = pc?.source_snapshot_url as string | undefined;
  const isFullPage = pc?.source_snapshot_full_page === true;
  if (!snapUrl) return null;
  return (
    <section className="animate-fade-up section-scroll section-scroll-purple rounded-2xl border border-border/80 bg-card/90 p-5 shadow-sm transition-all hover:shadow-md">
      <details className="group">
        <summary className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold text-muted-foreground transition hover:text-foreground [&::-webkit-details-marker]:hidden">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent">
            <span className="text-xs font-bold text-accent-foreground font-display">快</span>
          </span>
          <span>原题快照</span>
          {isFullPage ? (
            <span className="rounded bg-warning-light px-1.5 py-0.5 text-[10px] font-bold text-warning-foreground">整页</span>
          ) : null}
          <span className="ml-auto inline-block text-[10px] transition-transform group-open:rotate-90 opacity-50">▶</span>
        </summary>
        <div className="mt-3 ml-9 space-y-3">
          {isFullPage ? (
            <div className="rounded-lg border border-warning/30 bg-warning-light/70 px-3 py-2 text-xs text-warning-foreground">
              仅供审核使用，不会作为普通题图发布。
            </div>
          ) : null}
          <img
            src={snapUrl}
            alt="原题快照"
            className="max-w-full rounded-lg border border-border cursor-zoom-in"
            style={{ maxHeight: "400px" }}
            onClick={() => window.open(snapUrl, "_blank")}
          />
        </div>
      </details>
    </section>
  );
}

function RegionImage({ region }: { region: Record<string, unknown> | undefined }) {
  return (
    region?.image_url ? (
      <img src={String(region.image_url)} alt="题目区域截图" className="max-w-full rounded-lg border border-border" style={{ maxHeight: "400px" }} />
    ) : region?.page_image_url ? (
      <img src={String(region.page_image_url)} alt="原页截图" className="max-w-full rounded-lg border border-border" style={{ maxHeight: "400px" }} />
    ) : (
      <div className="rounded-lg border border-dashed border-border bg-muted/50 px-3 py-4 text-center text-xs text-muted-foreground/70">
        无原图对照
        {region?.bbox ? (
          <p className="mt-1 text-[10px]">定位信息：bbox={JSON.stringify(region.bbox)}</p>
        ) : null}
      </div>
    )
  );
}

function SourceRegion({ content }: { content: SourceProps["parsed_content"] }) {
  const pc = content as Record<string, unknown> | undefined;
  const srcRegion = pc?.source_region as Record<string, unknown> | undefined;
  const srcPage = pc?.source_page;
  if (!srcRegion && !srcPage) return null;
  return (
    <section className="animate-fade-up section-scroll section-scroll-purple rounded-2xl border border-border/80 bg-card/90 p-5 shadow-sm transition-all hover:shadow-md">
      <details className="group">
        <summary className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold text-muted-foreground transition hover:text-foreground [&::-webkit-details-marker]:hidden">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent">
            <span className="text-xs font-bold text-accent-foreground font-display">图</span>
          </span>
          <span>原图对照</span>
          {srcPage ? <span className="text-[10px] text-muted-foreground/70">第 {String(srcPage)} 页</span> : null}
          <span className="ml-auto inline-block text-[10px] transition-transform group-open:rotate-90 opacity-50">▶</span>
        </summary>
        <div className="mt-3 ml-9 space-y-3">
          <RegionImage region={srcRegion} />
        </div>
      </details>
    </section>
  );
}

export function ReviewSourceEvidence({ raw_data, parsed_content }: SourceProps) {
  return (
    <>
      <RawSource rawData={raw_data} />
      <SourceSnapshot content={parsed_content} />
      <SourceRegion content={parsed_content} />
    </>
  );
}
