import type { ComponentProps } from "react";
import { RootRouter } from "./root-router";

export { RootRouter } from "./root-router";

// Keep Expo's platform filtering, route root, and lazy import configuration.
// Only the production entry loads the production route graph. Recovery fixtures
// use the same router with their own routes without compiling unrelated screens.
const { ctx: context } = require("expo-router/_ctx") as {
  ctx: ComponentProps<typeof RootRouter>["context"];
};

export function RootApp() {
  return <RootRouter context={context} />;
}
