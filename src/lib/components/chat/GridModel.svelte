<script lang="ts">
    import {
      getFeeders,
      getRegions,
      getSubRegions,
      renderGridCombined
	} from '$lib/apis/chats';


  //import { powerSystemConfiguration } from '$lib/stores';
	import { onMount } from 'svelte';
  import GridVisualization from "./GridVisualization.svelte";


  interface Region {
    id: string;
    name: string;
  }

  interface SubRegion {
    id: string;
    name: string;
  }

  interface Feeder {
    id: string;
    name: string;
  }

  export let selectedRegion = "";
  export let selectedSubRegion = "";
  export let selectedFeeder = "";

    let regions: Region[] = [];
    let subRegions: SubRegion[] = [];
    let feeders: Feeder[] = [];
    let gridData = null;

    onMount(
        async () => {
        regions = await getRegions().catch(() => []);

        selectedRegion = "";
        selectedSubRegion = "";
        selectedFeeder = "";
        }

    );

    async function getSubRegionsByRegingId(region: string) {
        try {
         
            subRegions = await getSubRegions(region).catch(() => []);
            feeders = []; // Reset lines when a new sub-region is selected
        } catch (error) {
        console.error("Error fetching sub-regions:", error);
        }
    }
    async function getFeedersBySubRegingId(subRegion: string) {
            try {
                feeders = await getFeeders(subRegion).catch(() => []);
            } catch (error) {
            console.error("Error fetching sub-regions:", error);
            }
        }
    
    async function getGridData(feederId: string) {
            try {
              gridData = await renderGridCombined(feederId).catch(() => null);
            } catch (error) {
            console.error("Error fetching sub-regions:", error);
            }
        }
    

    function handleRegionChange(event: Event) {
     
        const target = event.target as HTMLSelectElement;
        selectedRegion = target.value;
        console.log("Selected Region:", selectedRegion);
        selectedSubRegion = "";
        selectedFeeder = "";
        getSubRegionsByRegingId(selectedRegion);
    }
  
    function handleSubRegionChange(event: Event) {
        const target = event.target as HTMLSelectElement;
        selectedSubRegion = target.value;
        console.log("Selected Sub-Region:", selectedSubRegion);
        selectedFeeder = "";
        getFeedersBySubRegingId(selectedSubRegion)
    }
  
    function handleLineChange(event: Event) {
      const target = event.target as HTMLSelectElement;
      selectedFeeder = target.value;
      console.log("Selected Feeder:", selectedFeeder);
      console.log("Selected Region:", selectedRegion);
      console.log("Selected SubRegion:", selectedSubRegion);
      getGridData(selectedFeeder)
    }

  </script>
  <style>
    .container {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
        padding: 0.75rem;
        background-color: var(--bg-color);
        margin-top: 2rem;
    }

    .select-container {
        display: flex;
        align-items: center;
        gap: 1rem;
    }

    .label {
        min-width: 180px;
        font-weight: 500;
        font-size: 0.875rem;
        color: var(--text-color);
    }

    .select {
        min-width: 200px;
        padding: 0.375rem 0.75rem;
        border-radius: 0.375rem;
        border: 1px solid var(--border-color);
        background-color: var(--select-bg);
        color: var(--text-color);
        outline: none;
        transition: border-color 0.2s;
        font-size: 0.875rem;
    }

    .select:hover {
        border-color: var(--border-hover);
    }

    .select:focus {
        border-color: var(--border-focus);
        box-shadow: 0 0 0 2px var(--ring-color);
    }

    .visualization-container {
        width: 100%;
        height: calc(100vh - 270px);
        min-height: 500px;
        background-color: var(--bg-color);
        border-radius: 0.5rem;
        overflow: hidden;
    }

    :global(:root) {
        --bg-color: #ffffff;
        --text-color: #374151;
        --border-color: #d1d5db;
        --border-hover: #9ca3af;
        --border-focus: #3b82f6;
        --ring-color: rgba(59, 130, 246, 0.2);
        --select-bg: #ffffff;
    }

    :global(.dark) {
        --bg-color: #171717;
        --text-color: #f3f4f6;
        --border-color: #4b5563;
        --border-hover: #6b7280;
        --border-focus: #60a5fa;
        --ring-color: rgba(96, 165, 250, 0.2);
        --select-bg: #1f2937;
    }
  </style>
  
  <div class="container dark:bg-gray-900 bg-white">
    <div class="select-container">
        <label for="region-select" class="label dark:text-white">Geographical Region</label>
        <select
            id="region-select"
            class="select dark:bg-gray-900"
            bind:value={selectedRegion}
            on:change={handleRegionChange}
        >
            <option value="">Select a region</option>
            {#each regions as region}
                <option value={region.id}>{region.name}</option>
            {/each}
        </select>
    </div>

    <div class="select-container">
        <label for="subregion-select" class="label dark:text-white">Sub-geographical Region</label>
        <select
            id="subregion-select"
            class="select dark:bg-gray-900"
            bind:value={selectedSubRegion}
            on:change={handleSubRegionChange}
            disabled={!selectedRegion}
        >
            <option value="">Select a sub-region</option>
            {#each subRegions as subRegion}
                <option value={subRegion.id}>{subRegion.name}</option>
            {/each}
        </select>
    </div>

    <div class="select-container">
        <label for="feeder-select" class="label dark:text-white">Line Name</label>
        <select
            id="feeder-select"
            class="select dark:bg-gray-900"
            bind:value={selectedFeeder}
            on:change={handleLineChange}
            disabled={!selectedSubRegion}
        >
            <option value="">Select a feeder</option>
            {#each feeders as feeder}
                <option value={feeder.id}>{feeder.name}</option>
            {/each}
        </select>
    </div>

    <div class="visualization-container dark:bg-gray-900">
        <GridVisualization feederId={selectedFeeder} />
    </div>
  </div>
  