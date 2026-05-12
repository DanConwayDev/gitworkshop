---
name: theming
description: Add fonts via @fontsource, change color schemes, manage light/dark themes via CSS custom properties, and avoid the `isolate` + negative-z-index gotcha that hides background images. Activates when adjusting brand colors, adding fonts, switching themes, or building decorative backgrounds.
license: MIT
compatibility: opencode
metadata:
  audience: developers
---

# Theming, Fonts, and Color Schemes

The project ships with a complete light/dark theme system using CSS custom properties on `:root` / `.dark` and a `useTheme` hook for programmatic switching. `Inter Variable` is wired by default via `@fontsource-variable/inter`.

## Adding a font

Use `@fontsource` packages (any Google Font is available):

1. **Install:**

   ```sh
   pnpm add @fontsource-variable/inter        # variable font
   pnpm add @fontsource/poppins               # static font
   ```

2. **Import** in `src/main.tsx`:

   ```ts
   import "@fontsource-variable/inter";
   ```

3. **Wire in Tailwind** (`tailwind.config.ts`):

   ```ts
   export default {
     theme: {
       extend: {
         fontFamily: {
           sans: ["Inter Variable", "Inter", "system-ui", "sans-serif"],
         },
       },
     },
   };
   ```

**Font choices by use case:**

- Modern/clean: Inter Variable, Outfit Variable, Manrope.
- Professional/corporate: Roboto, Open Sans, Source Sans Pro.
- Creative/artistic: Poppins, Nunito, Comfortaa.
- Code/monospace: JetBrains Mono, Fira Code, Source Code Pro.

## Changing the color scheme

Theme colors are defined as CSS custom properties on `:root` (light) and `.dark` (dark) in `src/index.css`. To customise:

1. Update both `:root { ... }` and `.dark { ... }` blocks in `src/index.css`.
2. Use Tailwind's color palette or define your own.
3. Verify ≥ 4.5:1 contrast for body text and ≥ 3:1 for large text/UI elements.
4. Apply consistently across buttons, links, and accent surfaces.
5. Test both light and dark modes.

## Component styling patterns

- Use `cn()` (`@/lib/utils`) to merge conditional classes.
- Use `class-variance-authority` for component variants — copy an existing `ui/` component as a template.
- Add hover and `focus-visible:` rings to every interactive element.
- Respect `prefers-reduced-motion` with `motion-safe:` / `motion-reduce:` Tailwind variants.

## The `isolate` + negative-z-index gotcha

When using negative z-index (e.g. `-z-10`) for background images or decorative elements, **always add `isolate` to the parent container**:

```tsx
// ✅ Background image is visible
<div className="relative isolate overflow-hidden">
  <img className="absolute inset-0 -z-10" src={bg} />
  <h1>Hero</h1>
</div>

// ❌ Without `isolate`, -z-10 pushes the image behind the page background colour
//    and it disappears entirely.
```

`isolate` creates a local stacking context so negative z-index siblings stay within the parent rather than escaping all the way to the document root.

## `useTheme`

```ts
import { useTheme } from "@/hooks/useTheme";

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>Toggle</button>;
}
```

The theme state is persisted to localStorage via `AppProvider` (see `src/services/settings.ts`).
