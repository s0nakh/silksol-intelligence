<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture

- Keep the hackathon demo as a client-side analytics experience on the home route; services under `src/services` are framework-free and isomorphic so they can move behind an API unchanged.
- Centralize reusable control styling in `src/components/ui`; this keeps interaction states aligned with the project design tokens.
