export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function dayAt(offset: number, now = new Date()): Date {
  const day = new Date(now);
  day.setDate(day.getDate() + offset);
  return day;
}
export function itemRef(listId: string, itemId: string): string {
  return JSON.stringify([listId, itemId]);
}
export function remindersForDay<T extends { dueAt: string; done: boolean }>(
  items: T[],
  day: string,
  today: string,
): T[] {
  return items
    .filter(
      (item) =>
        !item.done &&
        Number.isFinite(Date.parse(item.dueAt)) &&
        (localDay(new Date(item.dueAt)) === day ||
          (day === today && localDay(new Date(item.dueAt)) < today)),
    )
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
}
