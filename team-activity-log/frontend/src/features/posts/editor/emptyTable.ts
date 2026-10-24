/** A 3×3 table with a header row, inserted by the composer's "Table" button. */
export const emptyTable = {
  type: "doc",
  content: [
    {
      type: "table",
      content: [0, 1, 2].map((r) => ({
        type: "tableRow",
        content: [0, 1, 2].map(() => ({ type: r === 0 ? "tableHeader" : "tableCell", content: [{ type: "paragraph" }] })),
      })),
    },
  ],
};
