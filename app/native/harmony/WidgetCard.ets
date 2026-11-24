const binding = new LocalStorage();

@Entry(binding)
@Component
struct WidgetCard {
  @LocalStorageProp('dimension') dimension: number = 2;
  @LocalStorageProp('range') rangeValue: string = '— km';
  @LocalStorageProp('soc') soc: string = '—';
  @LocalStorageProp('fuel') fuel: string = '';
  @LocalStorageProp('charging') charging: string = '状态未知';
  @LocalStorageProp('state') state: string = '打开应用查看车况';
  @LocalStorageProp('power') power: string = '';
  @LocalStorageProp('locked') locked: string = '—';
  @LocalStorageProp('inside') inside: string = '—';
  @LocalStorageProp('odometer') odometer: string = '';
  @LocalStorageProp('lockAction') lockAction: string = '解锁';
  @LocalStorageProp('canLock') canLock: boolean = false;
  @LocalStorageProp('canControl') canControl: boolean = false;

  private open(action: string): void {
    postCardAction(this, { action: 'router', abilityName: 'EntryAbility', params: { leapWidgetAction: action } });
  }

  @Builder action(label: string, key: string, enabled: boolean) {
    Text(label).fontSize(11).fontColor(enabled ? '#174e45' : '#49635d').borderRadius(8).backgroundColor('#d5ebe4')
      .padding({ left: 5, right: 5, top: 5, bottom: 5 })
      .onClick(() => { if (enabled) this.open(key); })
  }

  @Builder metric(label: string, value: string) {
    Column({ space: 2 }) {
      Text(label).fontSize(10).maxLines(1)
      Text(value).fontSize(12).minFontSize(8).maxFontSize(12).maxLines(1).fontWeight(FontWeight.Medium)
    }.alignItems(HorizontalAlign.Start).layoutWeight(1)
  }

  build() {
    Column({ space: 4 }) {
      Text(this.rangeValue).fontSize(this.dimension === 4 ? 28 : 22).fontWeight(FontWeight.Bold).maxLines(1)
      Text(this.soc + ' · ' + this.charging + (this.dimension > 2 && this.power ? ' · ' + this.power : '')).fontSize(11).maxLines(1)
      if (this.dimension > 2) { Text(this.state).fontSize(10).maxLines(1) }
      if (this.dimension === 4) {
        if (this.fuel) { Text('油量 ' + this.fuel).fontSize(12) }
        Row({ space: 5 }) {
          this.metric('车门', this.locked)
          this.metric('车内温度', this.inside)
          if (this.odometer) { this.metric('总里程', this.odometer) }
        }.width('100%')
      }
      Row({ space: 4 }) {
        this.action(this.lockAction, 'lock', this.canLock)
        this.action('空调', 'climate', this.canControl)
        if (this.dimension > 2) {
          this.action('后备箱', 'trunk', this.canControl)
          this.action('寻车', 'find', this.canControl)
        }
      }.width('100%')
    }.padding(11).width('100%').height('100%').alignItems(HorizontalAlign.Start)
      .justifyContent(FlexAlign.Center).backgroundColor('#e6f2ef').onClick(() => this.open('open'))
  }
}
