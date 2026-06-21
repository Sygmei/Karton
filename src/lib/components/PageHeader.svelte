<script lang="ts">
  export let title: string;
  export let subtitle: string | undefined = undefined;
  export let tone: "lime" | "amber" = "lime";

  const accentClassByTone = {
    lime: "bg-lime-300",
    amber: "bg-amber-300",
  };
</script>

<section
  class="grid gap-5 py-3 text-stone-100 sm:py-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
>
  <div class="min-w-0">
    <span
      class={`mb-4 block h-1 w-14 rounded-full ${accentClassByTone[tone]}`}
      aria-hidden="true"
    ></span>
    <h1 class="max-w-4xl text-3xl font-black sm:text-4xl">{title}</h1>
    {#if subtitle}
      <p class="mt-3 max-w-3xl text-base/7 text-stone-400">
        {subtitle}
      </p>
    {/if}
  </div>

  {#if $$slots.actions}
    <div class="min-w-0 md:justify-self-end">
      <slot name="actions" />
    </div>
  {/if}
</section>
