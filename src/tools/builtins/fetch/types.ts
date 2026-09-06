/** The only model-selectable input; transport policy remains trusted config. */
export interface FetchRequest {
  readonly url: string;
}

/** Complete, bounded decoded response returned by the internal FetchCore. */
export interface FetchResult {
  /** Final absolute HTTP(S) URL after every allowed redirect. */
  readonly url: string;
  readonly statusCode: number;
  readonly body: FetchBody;
}

/** Closed set of source forms understood by model-facing conversion. */
export type FetchBody = FetchHtmlBody | FetchTextBody;

/** HTML remains source data until the tool presentation layer converts it. */
export interface FetchHtmlBody {
  readonly kind: "html";
  readonly content: string;
}

/** Markdown and plain text need no HTML conversion but remain untrusted data. */
export interface FetchTextBody {
  readonly kind: "text";
  readonly format: "markdown" | "plain";
  readonly content: string;
}
