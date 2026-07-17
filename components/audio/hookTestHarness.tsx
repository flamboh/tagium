import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export const renderHook = <Props, Result>(
  useHook: (props: Props) => Result,
  initialProps: Props,
) => {
  let current: Result | undefined;
  let renderer: ReactTestRenderer;
  const Host = ({ hookProps }: { hookProps: Props }): ReactNode => {
    current = useHook(hookProps);
    return null;
  };

  act(() => {
    renderer = create(createElement(Host, { hookProps: initialProps }));
  });

  return {
    get result() {
      if (current === undefined) throw new Error("hook did not render");
      return current;
    },
    rerender(props: Props) {
      act(() => renderer.update(createElement(Host, { hookProps: props })));
    },
    unmount() {
      act(() => renderer.unmount());
    },
  };
};
