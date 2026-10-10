# Diagrams

`*.mmd` are the Mermaid sources of the README diagrams. The README shows the PNGs (they render everywhere, including the GitHub mobile app) and keeps the same Mermaid code in a collapsed block for zoom & pan on desktop. After editing a diagram, update both the `.mmd` file and the README block, then re-render:

```bash
for f in docs/diagrams/*.mmd; do b=${f%.mmd}
  npx -y @mermaid-js/mermaid-cli@11.4.2 -i $f -o $b.light.png -t default -b '#ffffff' -s 3 -w 1000
  npx -y @mermaid-js/mermaid-cli@11.4.2 -i $f -o $b.dark.png  -c docs/diagrams/dark.json -b '#0d1117' -s 3 -w 1000
done
```
