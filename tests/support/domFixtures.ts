export const buttonElementFixture = (
  focus: HTMLButtonElement["focus"],
  isConnected = true,
): HTMLButtonElement => {
  const button = new EventTarget() as HTMLButtonElement;
  Object.defineProperties(button, {
    focus: { value: focus },
    isConnected: { value: isConnected, writable: true },
  });
  return button;
};
