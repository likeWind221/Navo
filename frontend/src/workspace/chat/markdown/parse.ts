import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { mathFromMarkdown } from "mdast-util-math";
import { gfm } from "micromark-extension-gfm";
import { math } from "micromark-extension-math";
import { codes } from "micromark-util-symbol";
import type { Construct, Extension } from "micromark-util-types";
import type { Root } from "mdast";
import { createMathFlow } from "./math/flow.js";
import { backslashMathText } from "./math/inline.js";

export function parseMarkdown(text: string, streaming: boolean): Root {
  return fromMarkdown(text, {
    extensions: streaming ? [gfm()] : [gfm(), closedMath(), compatibility],
    mdastExtensions: streaming ? [gfmFromMarkdown()] : [gfmFromMarkdown(), mathFromMarkdown()],
  });
}

const compatibility: Extension = {
  flow: {
    [codes.backslash]: createMathFlow(codes.backslash, codes.leftSquareBracket, codes.rightSquareBracket, true),
    [codes.dollarSign]: createMathFlow(codes.dollarSign, codes.dollarSign, codes.dollarSign, false),
  },
  text: { [codes.backslash]: backslashMathText },
};

function closedMath(): Extension {
  const syntax = math();
  const dollar = syntax.flow![codes.dollarSign]!;
  const constructs = Array.isArray(dollar) ? dollar : [dollar];
  return { ...syntax, flow: { ...syntax.flow, [codes.dollarSign]: constructs.map(requireClosingFence) } };
}

function requireClosingFence(construct: Construct): Construct {
  return { ...construct, tokenize(effects, ok, nok) {
    const context = this;
    const start = context.events.length;
    return construct.tokenize.call(context, effects, (code) => {
      if (context.interrupt) return ok(code);
      const fences = context.events.slice(start).filter(([action, token]) => action === "enter" && token.type === "mathFlowFence");
      return fences.length >= 2 ? ok(code) : nok(code);
    }, nok);
  } };
}
