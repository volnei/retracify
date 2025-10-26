    import { h, render } from "https://esm.sh/preact@10.19.3";
    import { html } from "https://esm.sh/htm@3.1.1/preact";
    import { useMemo, useRef, useState } from "https://esm.sh/preact@10.19.3/hooks";
    const cx = (...classes) => classes.filter(Boolean).join(" ");

    const payloadEl = document.getElementById("reportData");
    const fallbackPayload = {
      summary: {
        packageCount: 0,
        dependencyCount: 0,
        cyclicDependencyCount: 0,
        undeclaredDependencyCount: 0,
        runtimeExternalCount: 0,
        toolingExternalCount: 0,
        typeExternalCount: 0,
        toolingDependencyCount: 0,
        packagesWithIssues: 0,
        averageDependencyCount: 0,
        averageToolingDeps: 0,
      },
      packages: [],
      meta: {
        rootDir: "",
        generatedAt: "",
        nodeVersion: "",
        systemInfo: "",
      },
    };

    let parsedPayload = fallbackPayload;
    if (payloadEl) {
      try {
        parsedPayload = JSON.parse(payloadEl.textContent || "{}") || fallbackPayload;
      } catch (error) {
        console.error("Failed to parse report payload", error);
      }
    }

    const payload = {
      summary: { ...fallbackPayload.summary, ...(parsedPayload.summary || {}) },
      packages: Array.isArray(parsedPayload.packages) ? parsedPayload.packages : [],
      meta: { ...fallbackPayload.meta, ...(parsedPayload.meta || {}) },
    };

    const buttonBase = "flex w-full items-center justify-center rounded-full border px-4 py-2.5 text-sm font-medium transition-colors sm:w-auto sm:px-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500/60";

    const SummaryCards = ({ summary, meta }) => html`
      <section class="space-y-5">
        <div class="flex flex-col gap-4 rounded-2xl border border-zinc-800/70 bg-[#0f0f13]/80 p-5 md:flex-row md:items-center md:justify-between">
          <div class="space-y-1">
            <h2 class="text-lg font-semibold text-zinc-100">Explore the report</h2>
            <p class="text-sm text-zinc-400">Inspect each workspace, filter by health, and map their relationships.</p>
          </div>
          <div class="flex flex-col text-right font-mono text-[11px] uppercase tracking-[0.25em] text-zinc-500">
            <span>Generated <span class="text-zinc-100">${meta.generatedAt}</span></span>
            <span>Runtime <span class="text-zinc-100">${meta.nodeVersion}</span></span>
            <span>Host <span class="text-zinc-100">${meta.systemInfo}</span></span>
          </div>
        </div>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div class="space-y-1 rounded-2xl border border-zinc-800 bg-[#111116] p-4">
            <p class="text-xs font-semibold uppercase tracking-wide text-zinc-500">Packages</p>
            <p class="text-lg font-semibold text-zinc-100">
              ${summary.packageCount}
              <span class="text-sm font-medium text-zinc-400">• ${summary.packagesWithIssues} need attention</span>
            </p>
            <p class="text-xs text-zinc-500">Root directory: <span class="text-zinc-200">${meta.rootDir}</span></p>
          </div>
          <div class="space-y-1 rounded-2xl border border-zinc-800 bg-[#111116] p-4">
            <p class="text-xs font-semibold uppercase tracking-wide text-zinc-500">Internal dependencies</p>
            <p class="text-lg font-semibold text-zinc-100">
              ${summary.dependencyCount}
              <span class="text-sm font-medium text-zinc-400">avg ${summary.averageDependencyCount}</span>
            </p>
            <p class="text-xs text-zinc-500">Cyclic edges: <span class="text-zinc-200">${summary.cyclicDependencyCount}</span></p>
          </div>
          <div class="space-y-1 rounded-2xl border border-zinc-800 bg-[#111116] p-4">
            <p class="text-xs font-semibold uppercase tracking-wide text-zinc-500">External footprint</p>
            <p class="text-lg font-semibold text-zinc-100">${summary.runtimeExternalCount}</p>
            <p class="text-xs text-zinc-500">Type-only:${" "}<span class="text-zinc-300">${summary.typeExternalCount}</span></p>
          </div>
          <div class="space-y-1 rounded-2xl border border-zinc-800 bg-[#111116] p-4">
            <p class="text-xs font-semibold uppercase tracking-wide text-zinc-500">Tooling footprint</p>
            <p class="text-lg font-semibold text-zinc-100">${summary.toolingExternalCount}
              <span class="text-sm font-medium text-zinc-400">tool deps</span>
            </p>
            <p class="text-xs text-zinc-500">Configs/scripts:<span class="text-zinc-200"> ${summary.toolingDependencyCount}</span> • avg ${summary.averageToolingDeps}</p>
          </div>
        </div>
      </section>
    `;

    const ViewToggle = ({ view, onChange }) => html`
      <div class="flex flex-col items-stretch gap-2 rounded-xl border border-zinc-800/70 bg-[#111116] p-2 sm:inline-flex sm:flex-row sm:items-center sm:gap-3">
        <button
          type="button"
          class=${cx(buttonBase, view === "list" ? "border-zinc-50 bg-zinc-50 text-zinc-900" : "border-zinc-800 bg-[#111116] text-zinc-300 hover:border-zinc-700 hover:text-zinc-100")}
          aria-pressed=${view === "list"}
          onClick=${() => onChange("list")}
        >List View</button>
        <button
          type="button"
          class=${cx(buttonBase, view === "blocks" ? "border-zinc-50 bg-zinc-50 text-zinc-900" : "border-zinc-800 bg-[#111116] text-zinc-300 hover:border-zinc-700 hover:text-zinc-100")}
          aria-pressed=${view === "blocks"}
          onClick=${() => onChange("blocks")}
        >Blocks View</button>
      </div>
    `;

    const filterOptions = [
      { id: "all", label: "All packages", accent: "bg-[#121217] text-zinc-400" },
      { id: "issues", label: "Needs attention", accent: "bg-[#1e1116] text-rose-200" },
      { id: "tooling", label: "Has tooling", accent: "bg-[#111b26] text-sky-200" },
    ];

    const FilterBar = ({ filter, setFilter, search, setSearch, counts }) => html`
      <div class="flex flex-col gap-4 rounded-xl border border-zinc-800/70 bg-[#0f0f13]/90 p-3 sm:p-4">
        <div class="grid gap-3 sm:grid-cols-3">
          ${filterOptions.map(({ id, label, accent }) => {
            const isActive = filter === id;
            return html`
              <button
                key=${id}
                type="button"
                class=${cx(
                  "flex w-full flex-col items-start gap-1 rounded-2xl border px-4 py-3 text-left transition",
                  isActive
                    ? "border-zinc-50 bg-zinc-50 text-zinc-900"
                    : "border-zinc-800 bg-[#111116] text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
                )}
                onClick=${() => setFilter(id)}
              >
                <span class=${cx(
                  "inline-flex items-center gap-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  isActive ? "bg-zinc-900/80 text-zinc-200" : accent
                )}>${label}</span>
                <span class="text-lg font-semibold text-zinc-100">${counts[id] ?? 0}</span>
                <span class="text-xs text-zinc-500">${id === "all" ? "Total packages" : id === "issues" ? "Missing deps or unused externals" : "Configs or scripts detected"}</span>
              </button>`;
          })}
        </div>
        <label class="flex w-full items-center gap-3 rounded-full border border-zinc-800 bg-[#111116] px-4 py-2 text-xs text-zinc-400">
          <span class="text-zinc-500">🔍</span>
          <input
            class="flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
            placeholder="Search packages"
            value=${search}
            onInput=${(event) => setSearch(event.currentTarget.value)}
          />
          ${search
            ? html`<button type="button" class="text-zinc-500 hover:text-zinc-200" onClick=${() => setSearch("")}>✕</button>`
            : null}
        </label>
      </div>
    `;

    const severityDotByLevel = {
      critical: "bg-rose-400",
      watch: "bg-blue-400",
      stable: "bg-zinc-500",
    };

    const DependencyDrilldown = ({ items, defaultExpanded = false }) => {
      const [copiedPath, setCopiedPath] = useState("");
      const copyTimerRef = useRef(null);

      if (!items || items.length === 0) return null;

      const handleCopy = async (filePath) => {
        try {
          if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(filePath);
          } else {
            window.prompt("Copy path", filePath);
          }
          if (copyTimerRef.current) {
            clearTimeout(copyTimerRef.current);
          }
          setCopiedPath(filePath);
          copyTimerRef.current = window.setTimeout(() => {
            setCopiedPath("");
            copyTimerRef.current = null;
          }, 1600);
        } catch (error) {
          window.prompt("Copy path", filePath);
        }
      };

      return html`
        <details class="group mt-4 rounded-2xl border border-zinc-800/70 bg-[#0f0f13]/80 p-4" open=${defaultExpanded}>
          <summary class="flex cursor-pointer items-center justify-between text-xs font-semibold uppercase tracking-wide text-zinc-400">
            <span class="flex items-center gap-2">
              <span class="text-zinc-300">📂</span>
              Dependency file map
            </span>
            <span class="text-[11px] text-zinc-500">${items.reduce((acc, item) => acc + item.fileCount, 0)} paths</span>
          </summary>
          <div class="mt-4 space-y-4">
            ${items.map(
              (item) => html`
                <div key=${item.name} class="space-y-2 rounded-2xl border border-zinc-800 bg-[#111116] p-3">
                  <div class="flex items-center justify-between gap-3">
                    <span class="font-mono text-xs text-zinc-200">${item.name}</span>
                    <span class="text-[11px] text-zinc-500">${item.fileCount} file${item.fileCount === 1 ? "" : "s"}</span>
                  </div>
                  <div class="space-y-1.5">
                    ${item.files.map(
                      (file) => html`
                        <div key=${file} class="flex items-center gap-2 rounded-sm bg-[#0f0f13] px-2 py-1">
                          <code class="flex-1 truncate font-mono text-[11px] text-zinc-300" title=${file}>${file}</code>
                          <button
                            type="button"
                            class="shrink-0 rounded border border-zinc-700/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-100"
                            onClick=${() => handleCopy(file)}
                          >
                            ${copiedPath === file ? "Copied" : "Copy"}
                          </button>
                        </div>
                      `,
                    )}
                  </div>
                </div>
              `,
            )}
          </div>
        </details>
      `;
    };

    const DependencyBadge = ({ dep }) => {
      const tones = dep.isUndeclared
        ? "bg-[#131318] text-zinc-200 hover:bg-[#18181d]"
        : dep.isCyclic
          ? "bg-[#131318] text-zinc-200 hover:bg-[#18181d]"
          : "bg-[#111116] text-zinc-300 hover:bg-[#15151a]";
      const accents = [];
      if (dep.isCyclic) accents.push("bg-red-500");
      if (dep.isUndeclared) accents.push("bg-orange-500");
      return html`
        <a href=${`#${dep.anchor}`}
          class=${`inline-flex items-center gap-2 rounded-sm px-3 py-1 text-xs font-medium transition-colors ${tones}`}>
          ${accents.length
            ? html`<span class="flex items-center gap-1">${accents.map((accent, index) => html`<span key=${index} class="h-2 w-2 rounded-sm ${accent}"></span>`)}</span>`
            : null}
          <span class="font-mono text-[11px]">${dep.name}</span>
        </a>`;
    };

    const ExternalBadge = ({ dep }) => {
      const tone = !dep.isDeclared
        ? "bg-orange-500/20 text-orange-100 hover:bg-orange-500/30"
        : dep.isUsed
          ? dep.isToolingOnly
            ? "bg-blue-500/15 text-blue-100 hover:bg-blue-500/25"
            : "bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
          : dep.isTypeOnly
            ? "bg-purple-500/15 text-purple-100 hover:bg-purple-500/25"
            : "bg-[#111116] text-zinc-300 hover:bg-[#15151a]";
      return html`
        <span class=${`inline-flex items-center gap-2 rounded-sm px-3 py-1 text-xs font-medium transition-colors ${tone}`}>
          <span class="font-mono text-[11px]">${dep.name}</span>
          <span class="rounded-sm bg-[#0c0c10] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-200/90">${dep.statusLabel}</span>
          ${dep.isTypeOnly
            ? html`<span class="rounded-sm bg-purple-500/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-50">Type</span>`
            : null}
          ${dep.isToolingOnly
            ? html`<span class="rounded-sm bg-blue-500/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-50">Tool</span>`
            : null}
          ${dep.isUsed && dep.usageCount > 0
          ? html`<span class="text-[10px] text-zinc-400">x${dep.usageCount}</span>`
            : null}
        </span>`;
    };

    const PackageCard = ({ pkg }) => html`
      <article
        id=${pkg.anchorId}
        class="group relative rounded-2xl border border-zinc-800/70 bg-[#0f0f13]/90 p-6 shadow-sm shadow-black/40 transition">
        <header class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div class="space-y-1">
            <h3 class="flex flex-wrap items-center gap-2 text-xl font-semibold text-zinc-100">
              <span class="text-zinc-300">📦</span>
              <span>${pkg.displayName}</span>
              ${pkg.isRoot
                ? html`<span class="rounded-sm bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">Root</span>`
                : null}
              ${pkg.version
                ? html`<span class="rounded-sm bg-[#111116] px-3 py-0.5 text-xs font-medium text-zinc-300">v${pkg.version}</span>`
                : null}
            </h3>
            ${pkg.description
              ? html`<p class="max-w-[32ch] text-[11px] text-zinc-400/90 line-clamp-2">${pkg.description}</p>`
              : null}
            ${pkg.relativeDir
              ? html`<p class="font-mono text-xs text-zinc-500">${pkg.relativeDir}</p>`
              : null}
            ${pkg.severitySignals.length
              ? html`<div class="mt-2 flex flex-wrap gap-2">
                  ${pkg.severitySignals.map(
                    (signal, index) => html`<span
                      key=${index}
                      class="rounded-full bg-[#0f0f13] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400"
                    >
                      ${signal}
                    </span>`,
                  )}
                </div>`
              : null}
          </div>
          <div class="flex flex-wrap items-start justify-end gap-2">
            <span
              class=${`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${pkg.severityToneClass}`}
            >
              <span class=${`h-2 w-2 rounded-full ${severityDotByLevel[pkg.severityLevel] ?? "bg-zinc-500"}`}></span>
              ${pkg.severityLabel}
            </span>
            <dl class="grid grid-cols-2 gap-3 text-xs text-zinc-400 sm:text-sm md:text-right">
              <div>
                <dt class="uppercase tracking-wide text-zinc-500">Files</dt>
                <dd class="font-semibold text-zinc-200">${pkg.fileCount ?? 0}</dd>
              </div>
              <div>
                <dt class="uppercase tracking-wide text-zinc-500">Dependencies</dt>
                <dd class="font-semibold text-zinc-200">${pkg.dependencies.length}</dd>
              </div>
              <div>
                <dt class="uppercase tracking-wide text-zinc-500">References</dt>
                <dd class="font-semibold text-zinc-200">${pkg.references}</dd>
              </div>
              <div>
                <dt class="uppercase tracking-wide text-zinc-500">External</dt>
                <dd class="font-semibold text-zinc-200">${pkg.runtimeExternalCount}</dd>
              </div>
            </dl>
          </div>
        </header>
        <section class="mt-4">
          <h4 class="text-xs font-semibold uppercase tracking-wide text-zinc-500">Dependencies</h4>
          <div class="mt-2 flex flex-wrap gap-2.5">
            ${pkg.dependencyBadges.length
              ? pkg.dependencyBadges.map((dep, index) => html`<${DependencyBadge} key=${index} dep=${dep} />`)
              : html`<span class="rounded-sm bg-[#0f0f13] px-3 py-1 text-xs font-medium text-zinc-400">No internal dependencies</span>`}
          </div>
        </section>
        <section class="mt-4">
          <h4 class="text-xs font-semibold uppercase tracking-wide text-zinc-500">External Dependencies</h4>
          <div class="mt-2 flex flex-wrap gap-2.5">
            ${pkg.externalDependencyBadges.length
              ? pkg.externalDependencyBadges.map((dep, index) => html`<${ExternalBadge} key=${index} dep=${dep} />`)
              : html`<span class="rounded-sm bg-[#0f0f13] px-3 py-1 text-xs font-medium text-zinc-400">No external dependencies</span>`}
          </div>
        </section>
        <${DependencyDrilldown} items=${pkg.dependencyDrilldown} />
        ${pkg.toolingDepsList.length
          ? html`<section class="mt-4">
              <h4 class="text-xs font-semibold uppercase tracking-wide text-zinc-500">Tooling detected</h4>
              <div class="mt-2 flex flex-wrap gap-2.5">
                ${pkg.toolingDepsList.map((tool, index) => html`<span key=${index} class="rounded-sm bg-blue-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-100">${tool}</span>`)}
              </div>
            </section>`
          : null}
      </article>
    `;

    const PackageList = ({ packages }) => html`
      <div class="grid gap-5">
        ${packages.map((pkg) => html`<${PackageCard} key=${pkg.anchorId} pkg=${pkg} />`)}
      </div>
    `;

    const BlocksView = ({ packages }) => {
      const [hovered, setHovered] = useState(null);
      const [selected, setSelected] = useState(null);
      const dependentsByName = useMemo(() => {
        const map = new Map();
        packages.forEach((pkg) => {
          (pkg.dependencyBadges || []).forEach((dep) => {
            if (!map.has(dep.name)) map.set(dep.name, new Set());
            map.get(dep.name).add(pkg.anchorId);
          });
        });
        return map;
      }, [packages]);

      const focusKey = selected ?? hovered;
      const focusPackage = focusKey ? packages.find((pkg) => pkg.name === focusKey) : null;

      const activeDependents = focusKey ? dependentsByName.get(focusKey) || new Set() : new Set();

      const handleToggleSelect = (pkgName) => {
        setSelected((current) => (current === pkgName ? null : pkgName));
      };

      const handleKeyToggle = (event, pkgName) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleToggleSelect(pkgName);
        }
      };

      return html`
        <section class="rounded-2xl border border-zinc-800/70 bg-[#0f0f13]/90 p-5 shadow-sm shadow-black/40">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
            <h2 class="text-sm font-semibold uppercase tracking-wide text-zinc-400">Dependency Blocks</h2>
            <p class="text-xs text-zinc-500">Hover to preview dependents or click to lock a selection. Click again to clear.</p>
          </div>
          <div class="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            ${packages.map((pkg) => {
              const dependentsCount = dependentsByName.get(pkg.name)?.size ?? 0;
              const isSelected = selected === pkg.name;
              const isHovered = !isSelected && hovered === pkg.name;
              const isDependent = Boolean(focusKey) && activeDependents.has(pkg.anchorId);
              const severityDot = severityDotByLevel[pkg.severityLevel] ?? "bg-zinc-500";
              const baseClass = "block-card relative flex min-h-[88px] flex-col justify-between gap-4 rounded-2xl border border-zinc-800/70 bg-[#111116] px-4 py-3 shadow-sm shadow-black/30 transition duration-150 sm:min-h-[96px] sm:px-5 sm:py-4";
              const highlightClass = isSelected
                ? "ring-2 ring-zinc-400/70 bg-[#151519]"
                : isDependent
                  ? "ring-2 ring-rose-400/70 bg-[#161216]"
                  : isHovered
                    ? "ring-1 ring-zinc-700/60 bg-[#151519]"
                    : "hover:-translate-y-0.5 hover:bg-[#151519]";
              return html`
                <article
                  key=${pkg.anchorId}
                  class=${`${baseClass} ${highlightClass}`}
                  tabindex="0"
                  onMouseEnter=${() => setHovered(pkg.name)}
                  onFocus=${() => setHovered(pkg.name)}
                  onMouseLeave=${() => setHovered(null)}
                  onBlur=${() => setHovered(null)}
                  onClick=${() => handleToggleSelect(pkg.name)}
                  onKeyDown=${(event) => handleKeyToggle(event, pkg.name)}
                >
                  <div class="flex items-start justify-between gap-2">
                    <h3 class="line-clamp-2 text-sm font-medium leading-tight text-zinc-100">${pkg.displayName}</h3>
                    ${pkg.isRoot
                      ? html`<span class="shrink-0 rounded-sm bg-emerald-500/20 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-300">Root</span>`
                      : null}
                  </div>
                  <div class="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                    <span class=${`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${pkg.severityToneClass}`}>
                      <span class=${`h-2 w-2 rounded-full ${severityDot}`}></span>
                      ${pkg.severityLabel}
                    </span>
                    ${pkg.undeclaredDeps.length
                      ? html`<span class="inline-flex h-2 w-2 rounded-full bg-orange-500"></span>`
                      : null}
                    ${pkg.cyclicCount > 0
                      ? html`<span class="inline-flex h-2 w-2 rounded-full bg-red-500"></span>`
                      : null}
                    ${dependentsCount
                      ? html`<span class="rounded-sm bg-[#0f0f13] px-2 py-0.5 text-[10px] font-semibold text-zinc-300">${dependentsCount}</span>`
                      : null}
                  </div>
                  <div class="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                    <span class="rounded-sm bg-[#0f0f13] px-2 py-0.5 font-mono text-[10px] text-zinc-300">
                      ${pkg.dependencies.length} deps
                    </span>
                    <span class="rounded-sm bg-[#0f0f13] px-2 py-0.5 font-mono text-[10px] text-zinc-300">
                      ${dependentsCount} dependents
                    </span>
                    ${pkg.externalDependencyBadges.length
                      ? html`<span class="rounded-sm bg-blue-500/15 px-2 py-0.5 font-mono text-[10px] text-blue-100">
                          ${pkg.externalDependencyBadges.length} external
                        </span>`
                      : null}
                    ${pkg.undeclaredDeps.length
                      ? html`<span class="rounded-sm bg-orange-500/20 px-2 py-0.5 font-mono text-[10px] text-orange-100">
                          ${pkg.undeclaredDeps.length} undeclared
                        </span>`
                      : null}
                    ${pkg.cyclicCount > 0
                      ? html`<span class="rounded-sm bg-red-500/20 px-2 py-0.5 font-mono text-[10px] text-red-100">
                          ${pkg.cyclicCount} cyclic
                        </span>`
                      : null}
                  </div>
                </article>`;
            })}
          </div>
          ${focusPackage
            ? html`<div class="mt-6 rounded-2xl border border-zinc-800/70 bg-[#111116] p-5">
                <div class="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
                  <div>
                    <p class="text-xs uppercase tracking-wide text-zinc-500">Selected package</p>
                    <h3 class="text-lg font-semibold text-zinc-100">${focusPackage.displayName}</h3>
                    ${focusPackage.relativeDir
                      ? html`<p class="font-mono text-xs text-zinc-500">${focusPackage.relativeDir}</p>`
                      : null}
                    ${focusPackage.severitySignals.length
                      ? html`<div class="mt-2 flex flex-wrap gap-2">
                          ${focusPackage.severitySignals.map(
                            (signal, index) => html`<span
                              key=${index}
                              class="rounded-full bg-[#0f0f13] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400"
                            >
                              ${signal}
                            </span>`,
                          )}
                        </div>`
                      : null}
                  </div>
                  <button
                    type="button"
                    class="self-start rounded-full border border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100 sm:self-auto"
                    onClick=${() => setSelected(null)}
                  >
                    Clear selection
                  </button>
                </div>
                <div class="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <h4 class="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Internal dependencies (${focusPackage.dependencies.length})
                    </h4>
                    <div class="mt-2 flex flex-wrap gap-2">
                      ${focusPackage.dependencyBadges.length
                        ? focusPackage.dependencyBadges.map((dep, index) =>
                            html`<span
                              key=${index}
                              class="rounded-sm bg-[#0f0f13] px-3 py-1 text-xs font-medium text-zinc-200"
                            >
                              ${dep.name}
                            </span>`,
                          )
                        : html`<span class="rounded-sm bg-[#0f0f13] px-3 py-1 text-xs text-zinc-400">
                            No internal dependencies
                          </span>`}
                    </div>
                  </div>
                  <div>
                    <h4 class="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      External footprint (${focusPackage.externalDependencyBadges.length})
                    </h4>
                    <div class="mt-2 flex flex-wrap gap-2">
                      ${focusPackage.externalDependencyBadges.length
                        ? focusPackage.externalDependencyBadges.map((dep, index) =>
                            html`<span
                              key=${index}
                              class="rounded-sm bg-blue-500/15 px-3 py-1 text-xs font-medium text-blue-100"
                            >
                              ${dep.name}
                            </span>`,
                          )
                        : html`<span class="rounded-sm bg-[#0f0f13] px-3 py-1 text-xs text-zinc-400">
                            No external dependencies
                          </span>`}
                    </div>
                  </div>
                </div>
                <${DependencyDrilldown} items=${focusPackage.dependencyDrilldown} defaultExpanded=${false} />
              </div>`
            : null}
        </section>
      `;
    };

    const App = ({ data }) => {
      const [view, setView] = useState("list");
      const [filter, setFilter] = useState("all");
      const [search, setSearch] = useState("");

      const counts = useMemo(() => {
        const base = { all: data.packages.length, issues: 0, tooling: 0 };
        data.packages.forEach((pkg) => {
          if (pkg.hasIssues) base.issues += 1;
          if (pkg.toolingDepsList.length) base.tooling += 1;
        });
        return base;
      }, [data.packages]);

      const filteredPackages = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return data.packages.filter((pkg) => {
          if (filter === "issues" && !pkg.hasIssues) return false;
          if (filter === "tooling" && pkg.toolingDepsList.length === 0) return false;
          if (needle && !pkg.displayName.toLowerCase().includes(needle)) return false;
          return true;
        });
      }, [data.packages, filter, search]);

      return html`
        <div class="space-y-6">
          <${SummaryCards} summary=${data.summary} meta=${data.meta} />
          <div class="grid gap-4 lg:grid-cols-[auto,1fr]">
            <${ViewToggle} view=${view} onChange=${setView} />
            <${FilterBar}
              filter=${filter}
              setFilter=${setFilter}
              search=${search}
              setSearch=${setSearch}
              counts=${counts}
            />
          </div>
          ${filteredPackages.length === 0
            ? html`<div class="rounded-2xl border border-zinc-800/70 bg-[#0f0f13]/80 p-6 text-center text-sm text-zinc-400">No packages match the current filters.</div>`
            : view === "list"
              ? html`<${PackageList} packages=${filteredPackages} />`
              : html`<${BlocksView} packages=${filteredPackages} />`}
        </div>
      `;
    };

    const root = document.getElementById("app-root");
    if (root) {
      root.innerHTML = "";
      render(html`<${App} data=${payload} />`, root);
    }
  