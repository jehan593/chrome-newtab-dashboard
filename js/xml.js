// Minimal namespace-aware XML parser for CalDAV responses.
// DOMParser doesn't exist in the background service worker (no DOM),
// so this is used everywhere instead.

function decodeEntities(str) {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, "&");
}

class XmlNode {
  constructor(tagName, namespaceURI, localName) {
    this.tagName = tagName;
    this.namespaceURI = namespaceURI;
    this.localName = localName;
    this.attributes = {};
    this.children = [];
    this.textContent = "";
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  getElementsByTagNameNS(ns, localName) {
    const results = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (child.namespaceURI === ns && child.localName === localName) results.push(child);
        walk(child);
      }
    };
    walk(this);
    return results;
  }
}

/** Parse XML string into a lightweight tree. */
export function parseXML(xmlText) {
  let i = 0;
  const len = xmlText.length;

  function fail(msg) {
    throw new Error(`XML parse error: ${msg} (at offset ${i})`);
  }

  function skipWhitespace() {
    while (i < len && /\s/.test(xmlText[i])) i++;
  }

  function skipMisc() {
    skipWhitespace();
    while (
      xmlText.startsWith("<?", i) ||
      xmlText.startsWith("<!--", i) ||
      xmlText.startsWith("<!DOCTYPE", i)
    ) {
      if (xmlText.startsWith("<?", i)) {
        const end = xmlText.indexOf("?>", i);
        i = end === -1 ? len : end + 2;
      } else if (xmlText.startsWith("<!--", i)) {
        const end = xmlText.indexOf("-->", i);
        i = end === -1 ? len : end + 3;
      } else {
        const end = xmlText.indexOf(">", i);
        i = end === -1 ? len : end + 1;
      }
      skipWhitespace();
    }
  }

  function parseName() {
    const start = i;
    while (i < len && /[^\s=/>]/.test(xmlText[i])) i++;
    if (i === start) fail("expected a name");
    return xmlText.slice(start, i);
  }

  function parseAttributes() {
    const attrs = {};
    while (true) {
      skipWhitespace();
      if (xmlText[i] === "/" || xmlText[i] === ">" || i >= len) break;
      const name = parseName();
      skipWhitespace();
      if (xmlText[i] !== "=") {
        attrs[name] = "";
        continue;
      }
      i++; // '='
      skipWhitespace();
      const quote = xmlText[i];
      if (quote !== '"' && quote !== "'") fail("expected quoted attribute value");
      i++; // opening quote
      const start = i;
      while (i < len && xmlText[i] !== quote) i++;
      attrs[name] = decodeEntities(xmlText.slice(start, i));
      i++; // closing quote
    }
    return attrs;
  }

  function resolveNS(scope, prefix) {
    return Object.prototype.hasOwnProperty.call(scope, prefix) ? scope[prefix] : null;
  }

  function parseElement(nsStack) {
    if (xmlText[i] !== "<") fail("expected '<'");
    i++; // consume '<'
    const rawName = parseName();
    const attrs = parseAttributes();

    const scope = { ...nsStack[nsStack.length - 1] };
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "xmlns") scope[""] = v;
      else if (k.startsWith("xmlns:")) scope[k.slice(6)] = v;
    }
    nsStack.push(scope);

    const colonIdx = rawName.indexOf(":");
    const prefix = colonIdx === -1 ? "" : rawName.slice(0, colonIdx);
    const localName = colonIdx === -1 ? rawName : rawName.slice(colonIdx + 1);
    const node = new XmlNode(rawName, resolveNS(scope, prefix), localName);
    node.attributes = attrs;

    skipWhitespace();
    if (xmlText[i] === "/" && xmlText[i + 1] === ">") {
      i += 2;
      nsStack.pop();
      return node;
    }
    if (xmlText[i] !== ">") fail("expected '>' or '/>'");
    i++; // consume '>'

    let text = "";
    while (i < len) {
      if (xmlText.startsWith("</", i)) {
        const end = xmlText.indexOf(">", i);
        i = end === -1 ? len : end + 1;
        break;
      } else if (xmlText.startsWith("<!--", i)) {
        const end = xmlText.indexOf("-->", i);
        i = end === -1 ? len : end + 3;
      } else if (xmlText[i] === "<") {
        node.children.push(parseElement(nsStack));
      } else {
        const start = i;
        while (i < len && xmlText[i] !== "<") i++;
        text += xmlText.slice(start, i);
      }
    }

    node.textContent = node.children.length ? node.children.map((c) => c.textContent).join("") : decodeEntities(text);

    nsStack.pop();
    return node;
  }

  skipMisc();
  if (xmlText[i] !== "<") fail("no root element found");
  const root = parseElement([{}]);

  return {
    documentElement: root,
    getElementsByTagNameNS(ns, localName) {
      const results = [];
      if (root.namespaceURI === ns && root.localName === localName) results.push(root);
      results.push(...root.getElementsByTagNameNS(ns, localName));
      return results;
    },
  };
}
