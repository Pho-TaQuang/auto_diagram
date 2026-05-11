Draw.loadPlugin(function(ui) {
  const graph = ui.editor.graph;
  const model = graph.getModel();

  const oldIsCellConnectable = graph.isCellConnectable;

  function getText(cell) {
    try {
      return graph.convertValueToString(cell) || '';
    } catch (e) {
      return '';
    }
  }

  function isTopLevelClassBox(cell) {
    if (!cell || !cell.vertex) return false;

    const parent = model.getParent(cell);
    const geo = model.getGeometry(cell);
    const style = cell.style || '';
    const text = getText(cell);

    // Top-level class/swimlane box, not attribute/method row
    return (
      parent === graph.getDefaultParent() &&
      geo != null &&
      geo.width >= 60 &&
      geo.height >= 60 &&
      (
        style.indexOf('swimlane') >= 0 ||
        text.indexOf('<<') >= 0 ||
        text.indexOf('&lt;&lt;') >= 0
      )
    );
  }

  function isInsideClassBox(cell) {
    if (!cell || !cell.vertex) return false;

    let parent = model.getParent(cell);

    while (parent && parent !== graph.getDefaultParent() && parent !== model.getRoot()) {
      if (isTopLevelClassBox(parent)) {
        return true;
      }

      parent = model.getParent(parent);
    }

    return false;
  }

  graph.isCellConnectable = function(cell) {
    // Chặn nối vào attribute/method/member row nằm bên trong UML class
    if (isInsideClassBox(cell)) {
      return false;
    }

    // Vẫn cho nối vào class box cha như bình thường
    return oldIsCellConnectable.apply(this, arguments);
  };

  ui.editor.graph.refresh();
});
