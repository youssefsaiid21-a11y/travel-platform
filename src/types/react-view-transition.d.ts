// React's <ViewTransition> component (activated by Next.js's
// experimental.viewTransition flag) ships in Next's bundled React build but
// isn't declared by @types/react yet - see
// https://nextjs.org/docs/app/guides/view-transitions.
//
// The import below is required for TS to treat this as a module
// *augmentation* of "react" instead of a from-scratch module declaration
// that would shadow all of react's real exports (useState, etc.).
import "react";

declare module "react" {
  export function ViewTransition(props: {
    children?: ReactNode;
    name?: string;
    share?: string;
    default?: string;
    enter?: string | Record<string, string>;
    exit?: string | Record<string, string>;
  }): ReactElement | null;
}
