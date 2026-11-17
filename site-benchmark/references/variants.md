# Shapes of site-benchmark work

Each shape uses the rules in `SKILL.md` (roles, whole-page measurement, both widths, the capture script, the write-up). These are the extra steps each one needs.

## Discovery scan: who else does this

- Define "similar" from the project's positioning docs, and fix the rubric before searching: a handful of axes, each scored 1 to 5.
- Cast wide: 20 to 35 candidates. Then rank the closest 12 to 15 in one table per lens, with two lines each on why it is close and where it differs.
- Run searches one at a time with a pause between them; several at once hit the search tool's rate limit. Take each domain from the result's visible address text, not its redirect link.
- "Who ranks" is a separate tally: count organic results across several queries phrased the way a buyer would search. Keep it apart from the similarity ranking.
- Score the user's own site on the same axes, in the same table.
- Close with an overlap table (which sites appear under several lenses) and a shortlist for the next pass. Write every score down; a later pass will need them.

## Single-attribute measurement against a standing set

For questions like section spacing, hero imagery, gallery tiles, navigation items, phone-number size, or consent and tracking (read from the first-view shots, since preparation hides consent prompts).

- Start from the project's standing exemplar set if it has one, and add sites only through its written criteria.
- Measure the attribute across the whole page and several sections. Report each site's median and range, then the set's median and range (the median of the site medians, so each site counts once), with n.
- Compare like with like. Judge type scale by how much of its container the text fills, not by band height alone. Report gaps both as content-to-content distance and as padding, labelled, because designers think in padding.
- Measure the client's page the same way and place it in the table as the baseline.
- Decide navigation items, phone-number treatment and similar details from what the set does, not from inherited defaults.
- An aggregate over many sites can average a feature into something flat. Before turning one into a design default, look first-hand at the top few exemplars.

## Review of one site someone points at

- Treat the linked page as the entry. Capture the whole site at both widths (the main navigation pages, plus the sitemap for anything deeper), without logging in.
- Record when and how the pages were fetched.
- Sort the ideas three ways:
  - **Borrow now**, each with the condition it must meet before launch.
  - **Later candidates**, each with its dependencies, effort, and the condition that would make it worth doing.
  - **Not borrowing**, each with the reason.
- An idea outside the current brief is a costed candidate, not a "not borrowing". The brief is a starting position, and the people who set it decide once they've seen the cost.
- Keep criticism of the other site in a section marked internal. The people who pointed at it may admire it.
- Turn any content the new site would need into concrete asks for the client.

## Competitor teardown: how did they rank or convert

- Restate the claim being tested and confirm it: what ranked, for which query, from where, since when. A misread claim can sink the whole premise.
- Read what the project already holds on the competitor first.
- Date the evidence with sitemap `lastmod`, domain registration and archive snapshots. Some sites return a success code for pages that don't exist, and mirror or look-alike sites can serve someone else's content or contact details, so confirm which domain is the competitor's own.
- Separate organic results, ads and map listings. Keep the rank-check method fixed: switching between localized and non-localized results, or top 10 and top 20, can manufacture an apparent rise.
- Search engines block automated result pages. Without a rank tracker, use a search tool or API with a fixed location and depth, or the user's own screenshot, and name the method in the note.
- A fast rise often rests on things no capture can see: the map listing, reviews, links and domain history. Without a rank-history or backlink export, record those as unknown rather than crediting the page itself.
- For a large teardown, split by thread (rankings, content, conversion, visuals), each with a list of what to measure.
- Conversion is read from what the pages show (calls to action, forms, proof, friction). How well a site actually converts is unknown without its own analytics.
- Add a limits section. Blocked sources are missing data, not evidence. Say what would settle each open question.
- Finish with ranked next actions, and correct any project document the findings contradict.

## Multi-round audit, too big for one session

1. A kickoff writes a brief: purpose, sites and their short names, process, file names, commit pattern, tool guidance, and a status checklist.
2. **Round one**, one session per site: open exploration ending in candidate audit dimensions. Cover the page census, first viewport, messaging, visual system, structure, proof, search basics, mobile and performance.
3. **Criteria**, once every round-one file exists: the dimensions, with anchors for scores of 1, 3 and 5 and the evidence each needs.
4. **Round two**, one session per site: score every dimension with named evidence, and sort what it does into adopt, adapt and avoid.
5. **Synthesis**, once every round-two file exists: a side-by-side table and prioritized implications.

Each gated step checks that its inputs exist, and stops without writing anything if they don't. Parallel sessions sharing one checkout stage only their own paths. A git lock file means wait and retry.

## Standing exemplar catalog, when a project keeps one

- Give each site its role (design exemplar, ranking winner, contrast, baseline) from written criteria before scoring. Only exemplars feed positive patterns.
- Keep one row per site with a controlled vocabulary, and use `unknown` rather than a guess. Score at entry with a one-line reason, and validate the catalog after every change.
- Derive patterns only from eligible high-confidence exemplar rows, and report n and the number of unknowns.
- A client-fit score is a sanity check after the raw evidence, never evidence itself.
- When a new reviewer adds sites, have them score a few existing rows first, to catch drift in how the rubric is read.
