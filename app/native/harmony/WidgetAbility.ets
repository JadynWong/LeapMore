import { Want } from '@kit.AbilityKit';
import { FormExtensionAbility, formInfo, formBindingData, formProvider } from '@kit.FormKit';
import { widgetData, widgetPrefs } from '../plugins/LeapNative';

export default class WidgetAbility extends FormExtensionAbility {
  onAddForm(want: Want): formBindingData.FormBindingData {
    const id = want.parameters?.[formInfo.FormParam.IDENTITY_KEY] as string;
    const dimension = want.parameters?.[formInfo.FormParam.DIMENSION_KEY] as number ?? 2;
    const prefs = widgetPrefs(this.context);
    if (id) {
      prefs.putSync('widget-' + id, dimension);
      prefs.flush().catch(() => {});
    }
    return widgetData(prefs, dimension);
  }
  onUpdateForm(formId: string): void {
    const prefs = widgetPrefs(this.context);
    formProvider.updateForm(formId, widgetData(prefs, prefs.getSync('widget-' + formId, 2) as number)).catch(() => {});
  }
  onRemoveForm(formId: string): void {
    const prefs = widgetPrefs(this.context);
    prefs.deleteSync('widget-' + formId);
    prefs.flush().catch(() => {});
  }
}
