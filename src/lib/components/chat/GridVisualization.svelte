<script>
    import { onMount } from "svelte";
    import * as d3 from "d3";
    import { renderGridCombined } from "$lib/apis/chats";

    export let feederId = "";

    let canvas, ctx;
    let popup = { show: false, x: 0, y: 0, node: null };
    let zoomTransform = d3.zoomIdentity;

        // Scale variables for dynamic shape adjustment
    let zoomScale = 1;

    const width = 1000;
    const height = 700;

    let xScale, yScale, gridData;
    let zoomTimeout, updateTimeout;

    function getColorByType(type) {
        const colors = {
            ACLineSegment: "#1f77b4",
            EnergyConsumer: "#ff7f0e",
            EnergySource: "#2ca02c",
            PowerElectronicsConnection: "#d62728",
            PowerTransformer: "#9467bd",
            SynchronousMachine: "#8c564b"
        };
        return colors[type] || "#808080";
    }

    async function updateGridData() {
        if (updateTimeout) clearTimeout(updateTimeout);
        updateTimeout = setTimeout(async () => {
            if (feederId) {
                const data = await renderGridCombined(feederId);
                gridData = data;
                drawGrid();
            }
        }, 300);
    }

    $: {
        if (feederId) {
            updateGridData();
        }
    }

    function computeScales(data) {
        const xExtent = d3.extent(data.components.map(d => d.location.longitude));
        const yExtent = d3.extent(data.components.map(d => d.location.latitude));

        xScale = d3.scaleLinear().domain(xExtent).range([50, width - 50]);
        yScale = d3.scaleLinear().domain(yExtent).range([height - 50, 50]);
    }
    function getComponentShape(type, scale) {
    const baseSize = scale < 2 ? 1 : 1; // Change size on zoom level
    const shapeMap = {
        ACLineSegment: { shape: "rect", color: "red", size: [baseSize, baseSize] },
        /*Breaker: { shape: "rect", color: "#d62728", size: [baseSize * 2, baseSize] },
        ConnectivityNode: { shape: "circle", color: "#ff7f0e", size: [baseSize] },
        EnergyConsumer: { shape: "ellipse", color: "#2ca02c", size: [baseSize * 2, baseSize] },
        EnergySource: { shape: "circle", color: "#ff0000", size: [baseSize] },
        PowerTransformer: { shape: scale < 2 ? "rect" : "polygon", color: "#0000ff", size: scale < 2 ? [10, 10] : "0,-8 8,8 -8,8" },
        SynchronousMachine: { shape: "circle", color: "#ffff00", size: [baseSize] },
        TransformerTank: { shape: "rect", color: "#17becf", size: [baseSize * 1.5, baseSize] } */
    };
    //return shapeMap[type] || { shape: "circle", color: "#808080", size: [baseSize] };
    //return { shape: scale < 2 ? "circle" : "rect", color: "#ffa500", size: scale < 2 ?  [baseSize] :  [baseSize * 2, baseSize] }
    return shapeMap[type] ||  { shape: scale < 2 ? "circle" : "circle", color: "#ffa500", size: scale < 2 ?  [baseSize] :  [baseSize] }
}

    function detectCoordinateSystem(data) {
    let result = {
        isCartesian: false,
        rotation: 0, // Default is no rotation
        needsYInversion: false,
    };

    // First pass - determine coordinate system type
    let cartesianPoints = 0;
    let geographicPoints = 0;
    let totalPointsChecked = 0;
    const MAX_POINTS_TO_CHECK = 20;

    // Function to check a single point
    function checkCoordinateType(point) {
        // Lat/long coordinates are typically in the range of -180 to 180 for longitude
        // and -90 to 90 for latitude
        // If values are outside these ranges, it's likely a cartesian system
        if (Math.abs(point.longitude) > 180 || Math.abs(point.latitude) > 90) {
        cartesianPoints++;
        } else {
        geographicPoints++;
        }
        totalPointsChecked++;
    }

    // Function to detect if Y inversion might be needed
    function checkYAxisOrientation(points) {
        // Only relevant for cartesian systems
        if (!result.isCartesian) return;

        // For cartesian coordinates, we always want to invert Y
        result.needsYInversion = true;
    }

    // Function to detect if rotation is needed based on grid shape analysis
    function detectRotation(components, lines) {
        // This is a simplified detection - in a real system, we would need
        // more sophisticated algorithms to detect grid orientation

        // For now, we'll check if the grid's orientation seems to be rotated 90 degrees
        // by analyzing its overall shape

        // Calculate bounding box aspect ratio
        let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;

        const processPoint = (point) => {
        minX = Math.min(minX, point.longitude);
        maxX = Math.max(maxX, point.longitude);
        minY = Math.min(minY, point.latitude);
        maxY = Math.max(maxY, point.latitude);
        };

        // Process component locations
        components.forEach((comp) => {
        if (comp.hasLocation) {
            processPoint(comp.location);
        }
        });

        // Process line points
        lines.forEach((line) => {
        line.points.forEach(processPoint);
        });

        // Calculate aspect ratio of the grid
        const width = maxX - minX;
        const height = maxY - minY;

        // If grid is much wider than tall, it might be rotated 90 degrees from expected orientation
        // This is a very simple heuristic and should be adjusted based on actual grid models
        if (width > 0 && height > 0) {
        const aspectRatio = width / height;

        // Check if the grid has the IEEE123 transactive pattern's characteristics
        // This is based on analyzing the unique pattern of this specific grid
        if (aspectRatio > 3 || aspectRatio < 0.33) {
            // For extreme aspect ratios, it's likely we need rotation
            // Specifically, for the IEEE123 transactive model we know needs 90 degrees
            return 90;
        }
        }

        return 0; // Default is no rotation
    }

    // Check component locations
    if (data.components && data.components.length > 0) {
        // Check components with locations
        for (const comp of data.components) {
        if (comp.hasLocation && comp.location) {
            checkCoordinateType(comp.location);
            if (totalPointsChecked >= MAX_POINTS_TO_CHECK) break;
        }
        }
    }

    // Check line points if we need more samples
    if (
        totalPointsChecked < MAX_POINTS_TO_CHECK &&
        data.lines &&
        data.lines.length > 0
    ) {
        for (const line of data.lines) {
        if (line.points && line.points.length > 0) {
            for (const point of line.points) {
            checkCoordinateType(point);
            if (totalPointsChecked >= MAX_POINTS_TO_CHECK) break;
            }
            if (totalPointsChecked >= MAX_POINTS_TO_CHECK) break;
        }
        }
    }

    // Determine coordinate system type based on majority of points
    result.isCartesian = cartesianPoints > geographicPoints;

    // Now, determine if we need Y inversion - always yes for cartesian coordinates
    if (result.isCartesian) {
        result.needsYInversion = true;
    }

    // Detect if rotation is needed
    if (data.components && data.lines) {
        result.rotation = detectRotation(data.components, data.lines);
    }

    console.log(`Detected coordinate system for feeder ${data.feederId}:`);
    console.log(`- Type: ${result.isCartesian ? "Cartesian" : "Geographic"}`);
    console.log(`- Y-Inversion: ${result.needsYInversion ? "Yes" : "No"}`);
    console.log(`- Rotation: ${result.rotation}°`);

    return result;
    }


    function drawGrid() {

       /*  const distinctTypes = [...new Set(gridData.components.map(d => d.type))];
        console.log("distinctTypes:::",distinctTypes); */
        if (!ctx || !gridData) return;

        computeScales(gridData);

        ctx.clearRect(0, 0, width, height);
        // Detect coordinate system adjustments
     

        ctx.save();
        ctx.translate(zoomTransform.x, zoomTransform.y);
        ctx.scale(zoomTransform.k, zoomTransform.k);

        // Translate to center before applying rotation and inversion
        const centerX = width / 2;
        const centerY = height / 2;
        ctx.translate(centerX, centerY);
        const coordinateInfo = detectCoordinateSystem(gridData);
        if (coordinateInfo.rotation !== 0) {
            const angle = (coordinateInfo.rotation * Math.PI) / 180; // Convert degrees to radians
            ctx.rotate(angle);
        }

        if (coordinateInfo.needsYInversion) {
           ctx.scale(1, -1); // Invert Y-axis
        }
           // Translate back after transformations
        ctx.translate(-centerX, -centerY);

        ctx.lineWidth = 0.25;
        ctx.strokeStyle = "orange";

        // Draw lines
        gridData.lines.forEach(d => {
            ctx.beginPath();
            ctx.moveTo(xScale(d.points[0].longitude), yScale(d.points[0].latitude));
            ctx.lineTo(xScale(d.points[1].longitude), yScale(d.points[1].latitude));
            ctx.stroke();
        });

        // Draw nodes
        gridData.components.forEach(d => {
            const { shape, color, size } = getComponentShape(d.type,zoomScale);
            const x = xScale(d.location.longitude);
            const y = yScale(d.location.latitude);

            ctx.fillStyle = color;
            ctx.beginPath();

            if (shape === "circle") {
                ctx.arc(x, y, size[0], 0, 2 * Math.PI);
            } else if (shape === "rect") {
                ctx.fillRect(x - size[0] / 2, y - size[1] / 2, size[0], size[1]);
            } else if (shape === "polygon") {
                const points = size.split(" ").map((p) => {
                    const [px, py] = p.split(",").map(Number);
                    return [x + px, y + py];
                });
                ctx.moveTo(points[0][0], points[0][1]);
                points.slice(1).forEach(([px, py]) => ctx.lineTo(px, py));
                ctx.closePath();
            }

            ctx.fill();
        });

        ctx.restore();
    }

    function setupCanvas() {
        ctx = canvas.getContext("2d");
        d3.select(canvas)
            .call(d3.zoom()
                .scaleExtent([0.5, 10])
                .on("zoom", (event) => {
                    if (zoomTimeout) cancelAnimationFrame(zoomTimeout);
                    zoomTimeout = requestAnimationFrame(() => {
                        zoomScale = event.transform.k; // Track zoom level
                        zoomTransform = event.transform;
                        drawGrid();
                    });
                })
            )
            .on("click", event => checkClick(event));
    }

    function checkClick(event) {
    const [mx, my] = d3.pointer(event, canvas); // Mouse click relative to canvas
    const invX = (mx - zoomTransform.x) / zoomTransform.k;
    const invY = (my - zoomTransform.y) / zoomTransform.k;

    for (let d of gridData.components) {
        let x = xScale(d.location.longitude);
        let y = yScale(d.location.latitude);

        if (Math.abs(x - invX) < 4 && Math.abs(y - invY) < 4) {
            const rect = canvas.getBoundingClientRect(); // Get canvas position on page
            
            // Convert canvas coordinates to page coordinates
            const screenX = rect.left + zoomTransform.applyX(x);
            const screenY = rect.top + zoomTransform.applyY(y);

            popup = { 
                show: true, 
                x: screenX, 
                y: screenY - 30, // Position above the node
                node: d 
            };
            console.log("dddd",d)
            return;
        }
    }
    popup.show = false;
}



    function closePopup() {
        popup.show = false;
    }

    onMount(() => {
        setupCanvas();
    });
</script>

<style>
    .popup {
        position: absolute;
        background: white;
        border: 1px solid #ccc;
        padding: 10px;
        box-shadow: 2px 2px 10px rgba(0, 0, 0, 0.2);
        font-size: 14px;
    }

    .popup h4 {
        margin: 0;
        color: #333;
    }

    .popup button {
        display: block;
        margin-top: 5px;
    }
</style>

<canvas bind:this={canvas} width={width} height={height}></canvas>

{#if popup.show}
    <div class="popup" style="left: {popup.x}px; top: {popup.y}px;">
        <h4>{popup.node.name}</h4>
        <p>Type: {popup.node.type}</p>
        <p>Location: ({popup.node.location.latitude}, {popup.node.location.longitude})</p>
        <button on:click={closePopup}>Close</button>
    </div>
{/if}
