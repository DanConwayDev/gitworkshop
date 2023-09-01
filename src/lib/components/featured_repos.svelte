<div class="space-y-5">
  <div class="prose">
    <h3>Featured Repositories</h3>
  </div>
  {#each ["1", "2", "3"] as suffix}
    <div class="card w-96 bg-primary text-primary-content">
      <div class="card-body">
        <h2 class="card-title">Placeholder Repo {suffix}</h2>
        <p>Description of repository</p>
        <div class="card-actions justify-end">
          <button class="btn">Details</button>
        </div>
      </div>
    </div>
  {/each}
</div>
