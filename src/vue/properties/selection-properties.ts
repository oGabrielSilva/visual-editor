import { computed, ref, watch } from 'vue';
import * as v from 'valibot';
import { TextPresentationStyleSchema } from '../../security/text-presentation';
import { selectionProjectionKey } from '../projection-key';
import type { EditorWorkbench } from '../workbench';
import type { EditorSelectItem } from '../components/ui/EditorSelect.vue';
import {
  CHOICE_FIELDS,
  COLOR_FIELDS,
  MEASURE_FIELDS,
  PAGE_ONLY_STYLES,
  STYLE_GROUPS,
  styleGroup,
} from './style-fields';

/**
 * What the properties panel knows about the selected block: its values, what can be edited and
 * how a change is applied. Every change goes through the controller; a run of changes to one
 * field is one history step, and a refused value leaves the accepted one in place.
 */
export function useSelectionProperties(workbench: EditorWorkbench) {
  const { state } = workbench;
  const t = workbench.t;
  const controller = () => workbench.controller();
  const scope = computed(() => selectionProjectionKey(state.value));
  const errors = ref<Record<string, string>>({});
  const disabled = computed(() => state.value.readOnly);
  const selected = computed(() => {
    void scope.value;
    return controller().selected();
  });
  const region = computed(() => {
    void scope.value;
    const id = selected.value?.id;
    return id ? controller().resolveSelection(id) : undefined;
  });
  const capabilities = computed(() => {
    void scope.value;
    return controller().propertyCapabilities();
  });
  const imageSize = computed(() => {
    void scope.value;
    return controller().imageSize();
  });
  const layout = computed(() => {
    void scope.value;
    return controller().layoutSettings();
  });
  const imageLink = computed(() => {
    void scope.value;
    return controller().imageLink();
  });
  const styleValues = computed(() => {
    void scope.value;
    return selected.value ? controller().inlineStyles(selected.value.id) : {};
  });
  const effective = computed(() => {
    const metrics = workbench.effectiveText.value;
    if (
      !metrics ||
      metrics.documentId !== state.value.document.id ||
      metrics.revision !== state.value.document.revision ||
      metrics.targetId !== selected.value?.node.id
    )
      return undefined;
    const parsed = v.safeParse(TextPresentationStyleSchema, metrics.style);
    return parsed.success ? parsed.output : undefined;
  });
  watch(
    () => selected.value?.id,
    () => {
      errors.value = {};
      workbench.live.close();
    },
  );

  const hasAttribute = (name: string): boolean =>
    capabilities.value?.attributes.includes(name) ?? false;
  const attribute = (name: string): string => selected.value?.node.attrs?.[name] ?? '';
  const inherited = (name: string): boolean => {
    const value = styleValues.value[name];
    return !value || value === 'inherit';
  };
  /** The value of a style: the block's own, or what it inherits as the piece shows it. */
  const style = (name: string): string => {
    const value = styleValues.value[name] ?? '';
    if (value && value !== 'inherit') return value;
    const metrics = effective.value;
    if (metrics) {
      const [r, g, b, a] = metrics.color;
      const resolved: Readonly<Record<string, string>> = {
        color: `rgba(${r},${g},${b},${a})`,
        'font-size': `${metrics.size}px`,
        'line-height':
          typeof metrics.lineHeight === 'number' ? `${metrics.lineHeight}px` : metrics.lineHeight,
        'font-weight': String(metrics.weight),
        'font-family': metrics.font ?? metrics.family,
        'text-align': metrics.align,
      };
      if (resolved[name]) return resolved[name];
    }
    if (selected.value?.node.tag !== 'img' || !['width', 'height'].includes(name)) return value;
    const dimension = selected.value.node.attrs?.[name] ?? '';
    return /^\d+(?:\.\d+)?$/.test(dimension) ? `${dimension}px` : dimension;
  };
  const offered = (name: string): boolean => {
    if (
      !(capabilities.value?.styles.includes(name) ?? false) ||
      (name === 'grid-template-columns' && layout.value) ||
      (['width', 'height'].includes(name) && imageSize.value)
    )
      return false;
    return state.value.document.kind === 'page' || !PAGE_ONLY_STYLES.includes(name);
  };

  const settle = (field: string, ok: boolean): boolean => {
    if (ok) {
      delete errors.value[field];
      workbench.feedback.value = t('feedback.applied');
      return true;
    }
    errors.value[field] = t('properties.invalidValue');
    workbench.report('feedback.invalid');
    return false;
  };
  /** Applies one change as a step of its own, as the commit of a text or a choice in a list. */
  const apply = (field: string, action: () => boolean): boolean => {
    if (disabled.value) return false;
    workbench.live.close();
    let ok: boolean;
    try {
      ok = action();
    } catch {
      ok = false;
    }
    return settle(field, ok);
  };
  /**
   * Applies the value of a field which changes while the person types or drags. The run of
   * changes to that field is one history step; the error of a refused value stays next to it.
   */
  const applyLive = (field: string, action: () => boolean): boolean => {
    if (disabled.value) return false;
    const id = selected.value?.id ?? 'document';
    return settle(field, workbench.live.apply(`${id}:${field}`, action));
  };
  const updateStyle = (name: string, value: string): void => {
    applyLive(name, () => workbench.properties.style(name, value));
  };
  const updateAttribute = (name: string, value: string): void => {
    if (
      (name === 'href' || name === 'src') &&
      !controller()
        .linkPolicy()
        .isSafe(value, name === 'src' ? 'image' : 'link')
    ) {
      errors.value[name] = t(name === 'src' ? 'properties.invalidImage' : 'properties.invalidLink');
      return;
    }
    applyLive(name, () => workbench.properties.attribute(name, value));
  };

  const choices = (values: readonly (readonly [string, string])[]): EditorSelectItem[] =>
    values.map(([value, key]) => ({ value, label: t(key) }));
  const withCurrent = (value: string, items: readonly EditorSelectItem[]): EditorSelectItem[] =>
    value && !items.some((item) => item.value === value)
      ? [{ value, label: `${t('properties.currentValue')} ${value}` }, ...items]
      : [...items];
  const groups = computed(() =>
    STYLE_GROUPS.map((group) => ({
      id: group.id,
      label: t(group.label),
      openByDefault: group.open,
      selections: CHOICE_FIELDS.filter(
        (field) => styleGroup(field.name) === group.id && offered(field.name),
      ).map((field) => ({
        name: field.name,
        label: t(field.label),
        items: choices([['inherit', 'properties.inherited'], ...field.options]),
      })),
      measures: MEASURE_FIELDS.filter(
        (field) => styleGroup(field.name) === group.id && offered(field.name),
      ),
      colors: COLOR_FIELDS.filter(
        (field) => styleGroup(field.name) === group.id && offered(field.name),
      ),
    })).filter((group) => group.selections.length || group.measures.length || group.colors.length),
  );

  return {
    errors,
    disabled,
    selected,
    region,
    capabilities,
    imageSize,
    layout,
    imageLink,
    groups,
    hasAttribute,
    attribute,
    inherited,
    style,
    apply,
    applyLive,
    updateStyle,
    updateAttribute,
    choices,
    withCurrent,
  };
}

export type SelectionProperties = ReturnType<typeof useSelectionProperties>;
