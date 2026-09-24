export class RemoteTransitionGate {
  private active = false;

  get busy() {
    return this.active;
  }

  tryBegin() {
    if (this.active) return false;
    this.active = true;
    return true;
  }

  release() {
    this.active = false;
  }
}
