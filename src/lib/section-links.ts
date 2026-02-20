export type BuilderLinkKind = 'internal' | 'external';

export interface BuilderLink {
  label?: string;
  kind?: BuilderLinkKind;
  internalRoute?: string;
  externalUrl?: string;
  href?: string;
  openInNewTab?: boolean;
}

export const isExternalHref = (value: string): boolean =>
  /^(https?:)?\/\//i.test(value) || value.startsWith('mailto:');

export const normalizeInternalHref = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (isExternalHref(trimmed)) return trimmed;

  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  if (withSlash.endsWith('/')) return withSlash;
  return `${withSlash}/`;
};

export interface ResolvedLink {
  href: string;
  external: boolean;
  openInNewTab: boolean;
}

export function resolveBuilderLink(link?: BuilderLink): ResolvedLink | undefined {
  if (!link) return undefined;

  const kind = link.kind ?? 'internal';

  if (kind === 'external') {
    const target = (link.externalUrl ?? link.href ?? '').trim();
    if (!target) return undefined;
    return {
      href: target,
      external: true,
      openInNewTab: Boolean(link.openInNewTab)
    };
  }

  const route = normalizeInternalHref(link.internalRoute ?? link.href ?? '');
  if (!route) return undefined;

  return {
    href: route,
    external: false,
    openInNewTab: false
  };
}

export function resolveRouteValue(route?: string): string {
  return normalizeInternalHref(route ?? '');
}
