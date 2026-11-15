/**
 * The id of the section on screen, for the navigation of the header. A section counts as
 * current once its top passes the upper third of the viewport.
 */
export function useActiveSection(ids: readonly string[]) {
  const active = ref<string>();
  let observer: IntersectionObserver | undefined;
  onMounted(() => {
    const visible = new Map<string, boolean>();
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) visible.set(entry.target.id, entry.isIntersecting);
        active.value = ids.find((id) => visible.get(id));
      },
      { rootMargin: '-30% 0px -60% 0px' },
    );
    for (const id of ids) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
  });
  onBeforeUnmount(() => observer?.disconnect());
  return active;
}
