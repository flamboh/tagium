import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

const equalityOperators = new Set(["==", "===", "!=", "!=="]);

/** `typeof value === "function"` is capability detection, not representation parsing. */
function isFunctionCapabilityCheck(node: ESTree.UnaryExpression): boolean {
  const parent = node.parent;
  if (parent.type !== "BinaryExpression" || !equalityOperators.has(parent.operator)) return false;
  const counterpart = parent.left === node ? parent.right : parent.left;
  return counterpart.type === "Literal" && counterpart.value === "function";
}

/** Disallow runtime typeof checks that narrow unparsed values instead of decoding them. */
export const noRuntimeTypeofRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow runtime typeof checks; external values must be decoded into meaningful types at their I/O boundary.",
    },
    messages: {
      runtimeTypeof:
        "A `typeof` check narrows a representation without establishing its contract. Parse input at its I/O boundary, then branch on the domain value.",
    },
  },
  create(context) {
    return {
      UnaryExpression(node) {
        if (node.operator === "typeof" && !isFunctionCapabilityCheck(node)) {
          context.report({ node, messageId: "runtimeTypeof" });
        }
      },
    };
  },
});
