<script lang="ts">
    // Declare props for the modal
    export let isOpen: boolean = false;
    export let title: string = '';
    export let data: { [key: string]: any } | null = null;
  
    // Function to hide the popup
    const hidePopup = () => {
      isOpen = false;
    };
  </script>
  
  {#if isOpen}
    <div
      id="popup"
      class="bg-white dark:bg-gray-700 absolute  rounded-sm flex items-center justify-center transition-opacity duration-300 hidden" 
      role="dialog"
      aria-labelledby="popup-title"
      aria-hidden={!isOpen}
    >
      <div
        id="popup-content"
        class="bg-white dark:bg-gray-800 rounded-2xl shadow-lg w-96 p-6"
      >
        <!-- Header with Close button -->
        <div class="flex justify-between items-center mb-4">
          <h2 id="popup-title" class="text-xl font-semibold text-gray-700 dark:text-white">
            {title}
          </h2>
          <button
            id="close-popup"
            class="text-black hover:text-gray-700 dark:text-white dark:hover:text-gray-300"
            on:click={hidePopup}
            aria-label="Close"
          >
            ✖
          </button>
        </div>
  
        <!-- Table displaying the data -->
        {#if data}
          <div class="p-2 text-left font-medium text-black dark:text-white">
            <table class="min-w-full table-auto text-sm text-left text-gray-900 dark:text-white">
              <thead>
                <tr>
                  <th class="px-4 py-2 font-semibold">Attribute</th>
                  <th class="px-4 py-2 font-semibold">Value</th>
                </tr>
              </thead>
              <tbody>
                {#each Object.entries(data) as [key, value]}
                  <tr>
                    <td class="px-4 py-2 font-medium">{key}</td>
                    <td class="px-4 py-2">{value}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
  
        <div class="mt-4 flex justify-end">
          <button
            class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
            on:click={hidePopup}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  {/if}
  