import { setIcon } from 'obsidian';
import type { Locale } from './i18n';
import { TableMenu, type TableMenuAction } from './menu';

// ----
// Observer + button installation
// ----

/**
 * Register a MutationObserver that installs conversion buttons on any
 * newly added tables in the document body.
 */
export function registerConversionButtonObserver(
	onInstall: (root: HTMLElement) => void,
	register: (cb: () => unknown) => void,
): void {
	const observer = new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			mutation.addedNodes.forEach((node) => {
				if (node.instanceOf(HTMLElement)) {
					onInstall(node);
				}
			});
		}
	});
	observer.observe(activeDocument.body, { childList: true, subtree: true });
	register(() => observer.disconnect());
}

/**
 * Install conversion buttons for any tables in the given root element.
 * Returns the list of tables that were newly processed.
 */
export function installConversionButtons(
	root: HTMLElement,
	wasInstalled: WeakSet<HTMLTableElement>,
	enabled: boolean,
): HTMLTableElement[] {
	if (!enabled) return [];
	const tables = root.matches('table')
		? [root as HTMLTableElement]
		: Array.from(root.querySelectorAll<HTMLTableElement>('table'));

	const fresh: HTMLTableElement[] = [];
	tables.forEach((tableEl) => {
		if (wasInstalled.has(tableEl)) return;
		// Only process tables inside the main note editor area.
		// This prevents affecting tables in sidebars or third-party plugin panels
		// (e.g. Claudian chat, search results, etc.).
		if (!isInNoteEditorArea(tableEl)) return;
		wasInstalled.add(tableEl);
		fresh.push(tableEl);
	});
	return fresh;
}

/**
 * Returns true if the table element is inside the main note editor / reading
 * view area, i.e. within `.workspace-split.mod-vertical.mod-root`.
 * Tables that live in sidebars, modals, or third-party plugin panels are excluded.
 */
export function isInNoteEditorArea(el: HTMLElement): boolean {
	return !!el.closest(
		'.workspace-split.mod-vertical.mod-root, .markdown-preview-view, .cm-content',
	);
}

// ----
// Floating conversion button
// ----

export function installFloatingConversionButton(
	tableEl: HTMLTableElement,
	t: Locale,
	getActions: (tableEl: HTMLTableElement) => TableMenuAction[],
	register: (cb: () => unknown) => void,
): void {
	const button = activeDocument.body.createEl('button', {
		cls: 'better-table-convert-button mod-hidden',
		attr: {
			type: 'button',
			'aria-label': t.tableOptions,
			title: t.tableOptions,
		},
	});
	setIcon(button, 'table');

	let isHovering = false;
	let hideTimer: number | null = null;
	const setButtonActive = (active: boolean) => {
		if (hideTimer !== null) {
			window.clearTimeout(hideTimer);
			hideTimer = null;
		}
		isHovering = active;
		button.toggleClass('mod-active', active);
		updatePosition();
	};

	const updatePosition = () => {
		if (!tableEl.isConnected) {
			button.remove();
			return;
		}
		const rect = tableEl.getBoundingClientRect();
		const isVisible = rect.bottom > 0
			&& rect.top < activeWindow.innerHeight
			&& rect.right > 0
			&& rect.left < activeWindow.innerWidth;
		button.toggleClass('mod-hidden', !isVisible || !isHovering);
		if (!isVisible) return;
		const left = Math.max(4, rect.left - 36);
		const top = Math.max(4, rect.top + 2);
		button.style.setProperty('left', `${left}px`);
		button.style.setProperty('top', `${top}px`);
	};

	updatePosition();
	const resizeObserver = new ResizeObserver(updatePosition);
	resizeObserver.observe(tableEl);

	const onScrollOrResize = () => updatePosition();
	activeWindow.addEventListener('scroll', onScrollOrResize, true);
	activeWindow.addEventListener('resize', onScrollOrResize);

	const showButton = () => setButtonActive(true);
	const hideButton = () => {
		if (hideTimer !== null) window.clearTimeout(hideTimer);
		hideTimer = window.setTimeout(() => setButtonActive(false), 120);
	};
	tableEl.addEventListener('mouseenter', showButton);
	tableEl.addEventListener('mouseleave', hideButton);
	button.addEventListener('mouseenter', showButton);
	button.addEventListener('mouseleave', hideButton);

	button.addEventListener('mousedown', (e) => {
		e.preventDefault();
		e.stopPropagation();
	});
	button.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		TableMenu.show(tableEl, e, getActions(tableEl));
	});

	register(() => {
		resizeObserver.disconnect();
		activeWindow.removeEventListener('scroll', onScrollOrResize, true);
		activeWindow.removeEventListener('resize', onScrollOrResize);
		tableEl.removeEventListener('mouseenter', showButton);
		tableEl.removeEventListener('mouseleave', hideButton);
		button.removeEventListener('mouseenter', showButton);
		button.removeEventListener('mouseleave', hideButton);
		if (hideTimer !== null) window.clearTimeout(hideTimer);
		button.remove();
	});
}

// ----
// HTML embed source edit suppression
// ----

export function suppressHtmlEmbedSourceEdit(
	tableEl: HTMLTableElement,
	wasSuppressed: WeakSet<HTMLTableElement>,
): void {
	if (wasSuppressed.has(tableEl)) return;
	wasSuppressed.add(tableEl);

	const stopLeftClick = (e: MouseEvent) => {
		if (e.button === 2) return;
		const target = e.target as HTMLElement;
		if (target.closest('.better-table-convert-button')) return;

		activeDocument.querySelectorAll('.menu, .table-context-menu').forEach(menu => menu.remove());

		e.preventDefault();
		e.stopPropagation();
	};

	tableEl.addEventListener('mousedown', stopLeftClick);
	tableEl.addEventListener('click', stopLeftClick);
	tableEl.addEventListener('dblclick', stopLeftClick);
}

// ----
// Table menu dismiss on pointer
// ----

export function installTableMenuDismissHandler(
	tableEl: HTMLTableElement,
	wasInstalled: WeakSet<HTMLTableElement>,
): void {
	if (wasInstalled.has(tableEl)) return;
	wasInstalled.add(tableEl);

	const closeOnTablePointer = (e: MouseEvent | PointerEvent) => {
		if (e.button !== 0) return;
		const target = e.target;
		if (target instanceof Node && activeDocument.querySelector('.table-context-menu')?.contains(target)) return;
		TableMenu.closeAll();
	};

	tableEl.addEventListener('pointerdown', closeOnTablePointer, true);
	tableEl.addEventListener('mousedown', closeOnTablePointer, true);
}
