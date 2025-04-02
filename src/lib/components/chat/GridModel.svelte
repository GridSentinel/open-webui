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


  export let selectedRegion = "";
  export let selectedSubRegion = "";
  export let selectedFeeder = "";

    let regions: any[]  = [];
    let subRegions : any[]  = [];
    let feeders : any[]  = [];
    let gridData = null;

    onMount(
        async () => {
        regions = await getRegions().catch(async (error) => {
				return [];
			})
        }

    );

    async function getSubRegionsByRegingId(region: string) {
        try {
            subRegions = await getSubRegions(region).catch(async (error) => {
                    return [];
                });

            feeders = []; // Reset lines when a new sub-region is selected
        } catch (error) {
        console.error("Error fetching sub-regions:", error);
        }
    }
    async function getFeedersBySubRegingId(subRegion: string) {
            try {
                feeders = await getFeeders(subRegion).catch(async (error) => {
                        return [];
                    });
            } catch (error) {
            console.error("Error fetching sub-regions:", error);
            }
        }
    
    async function getGridData(feederId: string) {
            try {
              gridData = await renderGridCombined(feederId).catch(async (error) => {
                        return [];
                    });
            } catch (error) {
            console.error("Error fetching sub-regions:", error);
            }
        }
    

    function handleRegionChange(event) {
        selectedRegion = event.target.value;
        console.log("Selected Region:", selectedRegion);
        selectedSubRegion = "";
        selectedFeeder = "";
        getSubRegionsByRegingId(selectedRegion);
    }
  
    function handleSubRegionChange(event) {
        selectedSubRegion = event.target.value;
        console.log("Selected Sub-Region:", selectedSubRegion);
        selectedFeeder = "";
        getFeedersBySubRegingId(selectedSubRegion)
    }
  
    function handleLineChange(event) {
      selectedFeeder = event.target.value;
      console.log("Selected Feeder:", selectedFeeder);
      console.log("Selected Region:", selectedRegion);
      console.log("Selected SubRegion:", selectedSubRegion);
      getGridData(selectedFeeder)
    }

  </script>
  <style>
    .full-size {
      width: 100%;
      height: 100%;
      background-color: #000;
      border: 1px solid black;
      margin: 10px;
    }
  </style>
  
  <div class="dark:bg-gray-900 flex flex-col gap-4 mt-6 p-4 bg-white">
    <!-- First Selector -->
    <div class="flex items-center">
      <label for="region-select" class="mr-4 self-center font-medium text-sm text-gray-850 dark:text-white font-primary">Geographical region name</label>
      <select
        class="dark:bg-gray-900 w-fit pr-8 rounded-sm py-2 px-2 text-sm bg-transparent outline-none"
        bind:value={selectedRegion}
        on:change={handleRegionChange}
      >
        {#each regions as region}
            <option class="m-8"  value={region.id}>{region.name}</option>
        {/each}
      </select>
    </div>
  
    <!-- Second Selector -->
    <div class="flex items-center">
      <label for="tree-dropdown-1" class="mr-4 self-center font-medium text-sm text-gray-850 dark:text-white font-primary">Sub-geographical region name</label>
      <select 
        class="dark:bg-gray-900 w-fit pr-8 rounded-sm py-2 px-2 text-sm bg-transparent outline-none"
        bind:value={selectedSubRegion}
        on:change={handleSubRegionChange}
      >
      {#each subRegions as subRegion}
        <option value={subRegion.id}>{subRegion.name}</option>
      {/each}
      </select>
    </div>
  
    <!-- Third Selector -->
    <div class="flex items-center">
      <label for="tree-dropdown-2" class="mr-4 self-center font-medium text-sm text-gray-850 dark:text-white font-primary">Line name</label>
      <select 
        class="dark:bg-gray-900 w-fit pr-8 rounded-sm py-2 px-2 text-sm bg-transparent outline-none"
        bind:value={selectedFeeder}
        on:change={handleLineChange}
      >
      {#each feeders as feeder}
         <option class="p-2" value={feeder.id}>{feeder.name}</option>
      {/each}
      </select>
    </div>
  </div>
  
  <div class="max-w-full max-h-full full-size "  >

    <GridVisualization feederId ="{selectedFeeder}" />

  <!-- {#if gridData}

    <GridVisualization data={gridData}  
      on:nodeSelect={handleNodeSelect}
      on:linkSelect={handleLinkSelect}
      on:nodeEdit={handleNodeEdit} 
    -->
  <!--  {/if} -->
  </div>
  