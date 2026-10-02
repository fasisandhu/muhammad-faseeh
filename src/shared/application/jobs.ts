export interface Job {
  readonly name: string;
  run(): Promise<unknown>;
}
