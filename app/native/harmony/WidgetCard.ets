const binding = new LocalStorage();

@Entry(binding)
@Component
struct WidgetCard {
  @LocalStorageProp('dimension') dimension: number = 2;
  @LocalStorageProp('range') rangeValue: string = '— km';
  @LocalStorageProp('rangeLabel') rangeLabel: string = '续航';
  @LocalStorageProp('soc') soc: string = '—';
  @LocalStorageProp('fuel') fuel: string = '';
  @LocalStorageProp('charging') charging: string = '状态未知';
  @LocalStorageProp('chargeStatus') chargeStatus: string = '';
  @LocalStorageProp('state') state: string = '待同步';
  @LocalStorageProp('stale') stale: boolean = true;
  @LocalStorageProp('power') power: string = '';
  @LocalStorageProp('locked') locked: string = '—';
  @LocalStorageProp('inside') inside: string = '—';
  @LocalStorageProp('odometer') odometer: string = '';
  @LocalStorageProp('colorScheme') colorScheme: string = '';
  @LocalStorageProp('lockAction') lockAction: string = '解锁';
  @LocalStorageProp('climateOn') climateOn: boolean = false;
  @LocalStorageProp('trunkOpen') trunkOpen: boolean = false;
  @LocalStorageProp('canLock') canLock: boolean = false;
  @LocalStorageProp('canControl') canControl: boolean = false;
  @LocalStorageProp('canTrunk') canTrunk: boolean = false;
  @LocalStorageProp('canFind') canFind: boolean = false;

  private get small(): boolean { return this.dimension === 2; }
  private get large(): boolean { return this.dimension === 4; }
  private get dark(): boolean { return this.colorScheme === 'dark'; }
  private get surface(): Resource { return this.dark ? $r('app.color.widget_surface_dark') : $r('app.color.widget_surface_light'); }
  private get tile(): Resource { return this.dark ? $r('app.color.widget_tile_dark') : $r('app.color.widget_tile_light'); }
  private get ink(): Resource { return this.dark ? $r('app.color.widget_ink_dark') : $r('app.color.widget_ink_light'); }
  private get muted(): Resource { return this.dark ? $r('app.color.widget_muted_dark') : $r('app.color.widget_muted_light'); }
  private get accent(): Resource { return this.dark ? $r('app.color.widget_accent_dark') : $r('app.color.widget_accent_light'); }
  private get selected(): Resource { return this.dark ? $r('app.color.widget_selected_dark') : $r('app.color.widget_selected_light'); }
  private get chargeActive(): boolean { return this.chargeStatus === 'charging' || this.chargeStatus === 'done'; }
  private get chargeInk(): Resource { return this.chargeActive ? this.accent : this.chargeStatus === 'plugged' ? this.ink : this.muted; }

  private open(action: string): void {
    postCardAction(this, { action: 'router', abilityName: 'EntryAbility', params: { leapWidgetAction: action } });
  }

  @Builder icon(image: Resource, tint: Resource, size: number) {
    Image(image).width(size).height(size).fillColor(tint).objectFit(ImageFit.Contain)
  }

  @Builder action(label: string, key: string, image: Resource, enabled: boolean, active: boolean) {
    Column({ space: 3 }) {
      this.icon(image, active ? this.accent : this.ink, 17)
      Text(label).fontSize(11).fontColor(active ? this.accent : this.ink).maxLines(1)
    }.layoutWeight(1).height(this.small ? 34 : 38).justifyContent(FlexAlign.Center)
      .borderRadius(11).backgroundColor(active ? this.selected : this.tile).opacity(enabled ? 1 : 0.52)
      .onClick(() => { if (enabled) this.open(key); })
  }

  @Builder headline(label: string, value: string, unit: string) {
    Column({ space: 2 }) {
      Text() {
        Span(value.endsWith(unit) ? value.substring(0, value.length - unit.length).trim() : value)
        if (value.endsWith(unit)) { Span(unit).fontSize(this.small ? 10 : 12) }
      }.fontColor(this.ink).fontWeight(FontWeight.Bold).fontSize(this.small ? 24 : this.large ? 34 : 28)
        .minFontSize(15).maxFontSize(this.small ? 24 : this.large ? 34 : 28).maxLines(1)
      Text(label).fontSize(11).fontColor(this.muted).maxLines(1)
    }.alignItems(HorizontalAlign.Start)
  }

  @Builder charge() {
    Row({ space: 4 }) {
      Row({ space: 3 }) {
        this.icon(this.chargeStatus === 'charging' ? $r('app.media.widget_icon_bolt') : $r('app.media.widget_icon_plug'), this.chargeInk, 12)
        Text(this.charging).fontSize(10).fontColor(this.chargeInk).maxLines(1)
      }.backgroundColor(this.chargeActive ? this.selected : this.tile).borderRadius(6).padding({ left: 4, right: 4, top: 3, bottom: 3 })
      if (!this.small && this.power) { Text(this.power).fontSize(10).fontColor(this.ink).maxLines(1) }
    }
  }

  @Builder level(label: string, value: string, image: Resource, tint: Resource) {
    Row({ space: 5 }) {
      this.icon(image, this.muted, 15)
      Text(label).fontSize(11).fontColor(this.muted)
      Progress({ value: Math.min(100, Math.max(0, parseFloat(value) || 0)), total: 100, type: ProgressType.Linear })
        .layoutWeight(1).style({ strokeWidth: 5 }).color(tint).backgroundColor(this.tile)
      Text(isNaN(parseFloat(value)) ? '—' : value).width(32).textAlign(TextAlign.End).fontSize(11).fontColor(this.ink)
    }.width('100%')
  }

  @Builder metric(label: string, value: string) {
    Column({ space: 2 }) {
      Text(label).fontSize(11).fontColor(this.muted).maxLines(1)
      Text(value).fontSize(12).minFontSize(8).maxFontSize(12).maxLines(1).fontWeight(FontWeight.Medium).fontColor(this.ink)
    }.alignItems(HorizontalAlign.Start).layoutWeight(1).padding({ left: 7, right: 7, top: 6, bottom: 6 })
      .borderRadius(10).backgroundColor(this.tile)
  }

  build() {
    Column({ space: this.large ? 7 : 4 }) {
      Row({ space: this.small ? 4 : 8 }) {
        Column({ space: 2 }) {
          this.headline(this.rangeLabel, this.rangeValue, ' km')
          if (!this.small || this.stale) { Text(this.state).fontColor(this.muted).fontSize(11).maxLines(1) }
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        if (!this.large) {
          Column() { this.headline('电量', this.soc, '%') }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        }
        if (!this.small) {
          Column({ space: 3 }) {
            Image($r('app.media.leapmore')).width(this.large ? 44 : 32).height(this.large ? 44 : 32)
              .objectFit(ImageFit.Contain).borderRadius(this.large ? 10 : 7).clip(true)
            if (!this.large) { this.charge() }
          }.alignItems(HorizontalAlign.End)
        }
      }.width('100%').alignItems(VerticalAlign.Top)
      if (this.large) {
        this.level('电量', this.soc, $r('app.media.widget_icon_battery'), this.accent)
        if (this.fuel) { this.level('油量', this.fuel, $r('app.media.widget_icon_fuel'), this.dark ? $r('app.color.widget_fuel_dark') : $r('app.color.widget_fuel_light')) }
      }
      if (this.large || this.small) { this.charge() }
      Blank().layoutWeight(1)
      if (this.large) {
        Row({ space: 6 }) {
          this.metric('车门', this.locked === '锁状态未知' ? '—' : this.locked)
          this.metric('车内温度', this.inside)
          if (this.odometer) { this.metric('总里程', this.odometer) }
        }.width('100%')
      }
      Row({ space: 5 }) {
        this.action(this.lockAction, 'lock', this.lockAction === '上锁' ? $r('app.media.widget_icon_lock') : $r('app.media.widget_icon_unlock'), this.canLock, this.lockAction === '上锁')
        this.action('空调', 'climate', $r('app.media.widget_icon_fan'), this.canControl, this.climateOn)
        if (!this.small) {
          this.action('后备箱', 'trunk', this.trunkOpen ? $r('app.media.widget_icon_tailgate_open') : $r('app.media.widget_icon_tailgate'), this.canTrunk, this.trunkOpen)
          this.action('寻车', 'find', $r('app.media.widget_icon_find'), this.canFind, false)
        }
      }.width('100%')
    }.padding(this.small ? 11 : 12).width('100%').height('100%').alignItems(HorizontalAlign.Start)
      .backgroundColor(this.surface).borderRadius(23).onClick(() => this.open('open'))
  }
}
