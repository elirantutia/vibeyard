interface SchemaProperty {
  type?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
}

export interface JsonSchema {
  properties?: Record<string, SchemaProperty>;
  required?: string[];
}

interface SchemaForm {
  element: HTMLElement;
  getValues: () => Record<string, unknown>;
}

export function renderSchemaForm(schema: JsonSchema): SchemaForm {
  const container = document.createElement('div');
  container.className = 'mcp-schema-form';

  const properties = schema.properties || {};
  const required = new Set(schema.required || []);
  const inputs = new Map<string, () => unknown>();

  for (const [key, prop] of Object.entries(properties)) {
    const field = document.createElement('div');
    field.className = 'mcp-form-field';

    const label = document.createElement('label');
    label.textContent = key + (required.has(key) ? ' *' : '');
    if (prop.description) label.title = prop.description;
    field.appendChild(label);

    const type = prop.type || 'string';

    if (type === 'boolean') {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = prop.default === true;
      field.appendChild(input);
      inputs.set(key, () => input.checked);
    } else if (type === 'number' || type === 'integer') {
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'mcp-form-input';
      if (prop.default !== undefined) input.value = String(prop.default);
      if (prop.description) input.placeholder = prop.description;
      field.appendChild(input);
      inputs.set(key, () => input.value === '' ? undefined : Number(input.value));
    } else if (type === 'object' || type === 'array') {
      const textarea = document.createElement('textarea');
      textarea.className = 'mcp-form-input mcp-form-json';
      textarea.placeholder = `JSON ${type}`;
      textarea.rows = 3;
      if (prop.default !== undefined) textarea.value = JSON.stringify(prop.default, null, 2);
      field.appendChild(textarea);
      inputs.set(key, () => {
        const val = textarea.value.trim();
        if (!val) return undefined;
        try { return JSON.parse(val); } catch { return val; }
      });
    } else if (prop.enum && prop.enum.length > 0) {
      const select = document.createElement('select');
      select.className = 'mcp-form-input';
      for (const val of prop.enum) {
        const opt = document.createElement('option');
        opt.value = String(val);
        opt.textContent = String(val);
        select.appendChild(opt);
      }
      if (prop.default !== undefined) select.value = String(prop.default);
      field.appendChild(select);
      inputs.set(key, () => select.value);
    } else {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'mcp-form-input';
      if (prop.default !== undefined) input.value = String(prop.default);
      if (prop.description) input.placeholder = prop.description;
      field.appendChild(input);
      inputs.set(key, () => input.value === '' ? undefined : input.value);
    }

    container.appendChild(field);
  }

  return {
    element: container,
    getValues(): Record<string, unknown> {
      const result: Record<string, unknown> = {};
      for (const [key, getter] of inputs) {
        const val = getter();
        if (val !== undefined) result[key] = val;
      }
      return result;
    },
  };
}
