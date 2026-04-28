/**
 * Converte qualquer string em slug URL-friendly:
 * remove acentos, força lowercase, troca espaços/underscores por hífens
 * e descarta caracteres não [a-z0-9-]. Hífens duplicados e nas pontas
 * são colapsados.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}
