import { EditorView } from "@codemirror/view";

/**
 * A click past the end of a line puts the caret at its end, after any syntax hidden there.
 * CodeMirror would place it where the visible text stops, which is inside closing marks.
 */
export const clickPastLineEnd = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (
      event.button !== 0 ||
      event.detail !== 1 ||
      event.shiftKey ||
      event.altKey ||
      event.metaKey ||
      event.ctrlKey
    ) {
      return false;
    }
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;
    const line = view.state.doc.lineAt(pos);
    const end = view.coordsAtPos(line.to, -1);
    const onLastRow = end && event.clientY >= end.top && event.clientY <= end.bottom;
    if (!onLastRow || event.clientX <= end.right || pos === line.to) return false;
    view.dispatch({ selection: { anchor: line.to }, userEvent: "select.pointer" });
    view.focus();
    return true;
  },
});
