import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { Match } from "effect";

export const reactChildren = (node: ReactElement<{ children?: ReactNode }>): ReactNode[] =>
  Children.toArray(node.props.children);

export const reactText = (node: ReactNode): string =>
  Children.toArray(node)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? reactText(child.props.children)
        : Match.value(child).pipe(
            Match.when(Match.string, (value) => value),
            Match.when(Match.number, (value) => String(value)),
            Match.orElse(() => ""),
          ),
    )
    .join("");
