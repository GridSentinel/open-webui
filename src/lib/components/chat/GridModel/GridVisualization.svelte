<script lang="ts">
	import { onMount } from 'svelte';
	import * as d3 from 'd3';
	import { renderGridCombined, getComponentDetails } from '$lib/apis/grid';
	import { CIMComponentTypes , type CIMComponentType } from '$lib/types/cim';

	// Types
	interface Location {
		latitude: number;
		longitude: number;
	}

	interface Component {
		id: string;
		type: string;
		name?: string;
		hasLocation: boolean;
		location: Location;
		[key: string]: any;
	}

	interface Line {
		points: Location[];
	}

	interface GridData {
		feederId: string;
		components: Component[];
		lines: Line[];
	}

	interface PopupState {
		show: boolean;
		x: number;
		y: number;
		nodes: Component[];
	}

	interface DetailPopupState {
		show: boolean;
		x: number;
		y: number;
		node: Component | null;
	}

	interface CoordSystemInfo {
		isCartesian: boolean;
		rotation: number;
		needsYInversion: boolean;
	}

	interface ComponentShape {
		shape: 'circle' | 'rect' | 'polygon' | 'ellipse';
		color: string;
		size: number[] | string;
	}

	interface ComponentDetails extends Component {
		additionalDetails?: {
			[key: string]: any;
		};
	}

	export let feederId = '';

	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D | null = null;
	let coordSystemInfo: CoordSystemInfo | null = null;
	let popup: PopupState = { show: false, x: 0, y: 0, nodes: [] };
	let detailPopup: DetailPopupState = { show: false, x: 0, y: 0, node: null };
	let selectedComponent: ComponentDetails | null = null;
	let zoomTransform = d3.zoomIdentity;
	let pathCache: Record<string, Path2D> = {};
	let zoomScale = 1;
	let componentPositions = new Map<string, string[]>();
	let width = 0;
	let height = 0;
	let xScale: d3.ScaleLinear<number, number>;
	let yScale: d3.ScaleLinear<number, number>;
	let gridData: GridData;
	let zoomTimeout: ReturnType<typeof requestAnimationFrame>;
	let updateTimeout: ReturnType<typeof setTimeout>;
	let isLoadingDetails = false;
	let errorMessage: string | null = null;
	let zoomPercentage = 100;
	let zoomInstance: d3.ZoomBehavior<HTMLCanvasElement, unknown>;
	let selectedComponentTypes: Set<string> = new Set();
	let showFilters = false;
	let showLegend = false;
	let isLoadingGrid = false;
	let isLargeModel = false;
	let coordinateCache = new Map<string, Component[]>();

	// Add all component types
	const allComponentTypes: CIMComponentType[] = Object.values(CIMComponentTypes);

	function getComponentColor(type: CIMComponentType): string {
		const colorMap: Record<CIMComponentType, string> = {
			[CIMComponentTypes.ACLineSegment]: '#ff0000',
			[CIMComponentTypes.Breaker]: '#d62728',
			[CIMComponentTypes.ConnectivityNode]: '#0000ff',
			[CIMComponentTypes.EnergyConsumer]: '#2ca02c',
			[CIMComponentTypes.EnergySource]: '#ff0000',
			[CIMComponentTypes.Fuse]: '#e377c2',
			[CIMComponentTypes.LinearShuntCompensator]: '#7f7f7f',
			[CIMComponentTypes.LoadBreakSwitch]: '#bcbd22',
			[CIMComponentTypes.BatteryUnit]: '#17becf',
			[CIMComponentTypes.PhotovoltaicUnit]: '#ffd700',
			[CIMComponentTypes.PowerTransformer]: '#ff7f0e',
			[CIMComponentTypes.RatioTapChanger]: '#8c564b',
			[CIMComponentTypes.Recloser]: '#9467bd',
			[CIMComponentTypes.SynchronousMachine]: '#ffff00',
			[CIMComponentTypes.TransformerTank]: '#17becf'
		};
		return colorMap[type] || '#000000';
	}

	function resetZoom() {
		if (zoomInstance && canvas) {
			d3.select(canvas)
				.transition()
				.duration(750)
				.call(zoomInstance.transform, d3.zoomIdentity);
		}
	}

	function zoomIn() {
		if (zoomInstance && canvas) {
			d3.select(canvas)
				.transition()
				.duration(750)
				.call(zoomInstance.scaleBy, 1.5);
		}
	}

	function zoomOut() {
		if (zoomInstance && canvas) {
			d3.select(canvas)
				.transition()
				.duration(750)
				.call(zoomInstance.scaleBy, 0.75);
		}
	}

	function resizeCanvas() {
		if (canvas) {
			const parent = canvas.parentElement;
			if (parent) {
				// Store the current zoom transform
				const currentTransform = zoomTransform;
				
				// Update canvas dimensions
				canvas.width = parent.clientWidth;
				canvas.height = parent.clientHeight;
				width = parent.clientWidth;
				height = parent.clientHeight;
				
				// Recompute scales if we have grid data
				if (gridData) {
					computeScales(gridData);
				}
				
				// Redraw the grid
				drawGrid();
				
				// Restore the zoom transform
				if (zoomInstance && canvas) {
					d3.select(canvas)
						.call(zoomInstance.transform, currentTransform);
				}
			}
		}
	}

	// Add a debounced resize handler
	let resizeTimeout: ReturnType<typeof setTimeout>;
	function handleResize() {
		if (resizeTimeout) clearTimeout(resizeTimeout);
		resizeTimeout = setTimeout(() => {
			resizeCanvas();
		}, 100);
	}

	$: {
		if (feederId && feederId !== '') {
			isLoadingGrid = true;
			resetZoom();
			clearCoordinateCache(); // Clear cache when new data is loaded
			updateGridData();
		}
	}

	async function updateGridData() {
		if (updateTimeout) clearTimeout(updateTimeout);
		updateTimeout = setTimeout(async () => {
			if (feederId) {
				try {
					console.log('Fetching grid data for feeder:', feederId);
					const data = await renderGridCombined(feederId);
					console.log('Received grid data:', data);
					gridData = data;				
					
					// Check if model is large
					isLargeModel = isModelLarge(data.components);
					
					// Detect coordinate system before computing scales
					coordSystemInfo = detectCoordinateSystem(data);
					
					computeScales(data);
					drawGrid();
				} catch (error) {
					console.error('Error fetching grid data:', error);
				} finally {
					isLoadingGrid = false;
				}
			}
		}, 300);
	}

	function computeScales(data: GridData) {
		const xExtent = d3.extent(data.components.map((d) => d.location.longitude));
		const yExtent = d3.extent(data.components.map((d) => d.location.latitude));

		if (!xExtent[0] || !xExtent[1] || !yExtent[0] || !yExtent[1]) return;

		// Add padding to the extent
		const xPadding = (xExtent[1] - xExtent[0]) * 0.1;
		const yPadding = (yExtent[1] - yExtent[0]) * 0.1;

		xScale = d3
			.scaleLinear()
			.domain([xExtent[0] - xPadding, xExtent[1] + xPadding])
			.range([0, width]);
		yScale = d3
			.scaleLinear()
			.domain([yExtent[0] - yPadding, yExtent[1] + yPadding])
			.range([height, 0]);
	}

	function isModelLarge(components: Component[]): boolean {
		return components.length > 1000;
	}

	function getComponentShape(type: string, scale: number): ComponentShape {
		// Base size calculation based on model size and zoom level
		let baseSize: number;
		if (isLargeModel) {
			// For large models, use smaller base size and less aggressive scaling
			baseSize = scale > 2 ? 0.8 : 1;
		} else {
			// For smaller models, use larger base size and more aggressive scaling
			baseSize = scale > 2 ? 4 : 2;
		}
		
		// Get base color for the equipment type
		const baseColor = getComponentColor(type as CIMComponentType);

		// Define shapes for different equipment types
		const shapes: Record<CIMComponentType, ComponentShape> = {
			[CIMComponentTypes.ACLineSegment]: { shape: 'circle', color: baseColor, size: [baseSize] },
			[CIMComponentTypes.Breaker]: { shape: 'circle', color: baseColor, size: [baseSize] },
			[CIMComponentTypes.ConnectivityNode]: { shape: 'circle', color: baseColor, size: [baseSize] },
			[CIMComponentTypes.EnergyConsumer]: { shape: 'circle', color: baseColor, size: [baseSize] },
			[CIMComponentTypes.EnergySource]: { shape: 'circle', color: baseColor, size: [baseSize] },
			[CIMComponentTypes.Fuse]: { shape: 'circle', color: baseColor, size: [baseSize] },
			[CIMComponentTypes.LinearShuntCompensator]: { shape: 'circle', color: baseColor, size: [baseSize] },
			[CIMComponentTypes.LoadBreakSwitch]: { shape: 'circle', color: baseColor, size: [baseSize] },
			[CIMComponentTypes.BatteryUnit]: { shape: 'circle', color: baseColor, size: [baseSize] },
			[CIMComponentTypes.PhotovoltaicUnit]: { shape: 'circle', color: baseColor, size: [baseSize] },
			[CIMComponentTypes.PowerTransformer]: { shape: 'circle', color: baseColor, size: [baseSize] },
			[CIMComponentTypes.RatioTapChanger]: { shape: 'circle', color: baseColor, size: [baseSize] },
			[CIMComponentTypes.Recloser]: { shape: 'circle', color: baseColor, size: [baseSize] },
			[CIMComponentTypes.SynchronousMachine]: { shape: 'circle', color: baseColor, size: [baseSize] },
			[CIMComponentTypes.TransformerTank]: { shape: 'circle', color: baseColor, size: [baseSize] }
		};

		return shapes[type as CIMComponentType] || { shape: 'circle', color: baseColor, size: [baseSize] };
	}

	function getOffsetPosition(x: number, y: number, componentId: string) {
		const key = `${x},${y}`;
		if (!componentPositions.has(key)) {
			componentPositions.set(key, []);
		}
		const componentsAtPosition = componentPositions.get(key) || [];
		const index = componentsAtPosition.indexOf(componentId);
		
		if (index === -1) {
			componentsAtPosition.push(componentId);
			return { x, y };
		}
		
		const offset = 1;
		const angle = (index * 1 * Math.PI) / 5;
		const cosAngle = Math.cos(angle);
		const sinAngle = Math.sin(angle);
		return {
			x: x + cosAngle * offset,
			y: y + sinAngle * offset
		};
	}

	function detectCoordinateSystem(data: GridData): CoordSystemInfo {
		let result: CoordSystemInfo = {
			isCartesian: false,
			rotation: 0,
			needsYInversion: false
		};

		// First pass - determine coordinate system type
		let cartesianPoints = 0;
		let geographicPoints = 0;
		let totalPointsChecked = 0;
		const MAX_POINTS_TO_CHECK = 20;

		// Function to check a single point
		function checkCoordinateType(point: Location) {
			if (Math.abs(point.longitude) > 180 || Math.abs(point.latitude) > 90) {
				cartesianPoints++;
			} else {
				geographicPoints++;
			}
			totalPointsChecked++;
		}

		// Function to detect if rotation is needed based on grid shape analysis
		function detectRotation(components: Component[], lines: Line[]): number {
			let minX = Infinity,
				maxX = -Infinity,
				minY = Infinity,
				maxY = -Infinity;

			const processPoint = (point: Location) => {
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

			if (width > 0 && height > 0) {
				const aspectRatio = width / height;
				if (aspectRatio > 3 || aspectRatio < 0.33) {
					return 90;
				}
			}

			return 0;
		}

		// Check component locations
		if (data.components && data.components.length > 0) {
			for (const comp of data.components) {
				if (comp.hasLocation && comp.location) {
					checkCoordinateType(comp.location);
					if (totalPointsChecked >= MAX_POINTS_TO_CHECK) break;
				}
			}
		}

		// Check line points if we need more samples
		if (totalPointsChecked < MAX_POINTS_TO_CHECK && data.lines && data.lines.length > 0) {
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
		result.needsYInversion = result.isCartesian;

		// Detect if rotation is needed
		if (data.components && data.lines) {
			result.rotation = detectRotation(data.components, data.lines);
		}

		console.log(`Detected coordinate system for feeder ${data.feederId}:`, result);
		return result;
	}

	function coordinatesMatch(coord1: Location, coord2: Location, tolerance = 0.0001): boolean {
		const dx = coord1.longitude - coord2.longitude;
		const dy = coord1.latitude - coord2.latitude;
		return (dx * dx + dy * dy) < (tolerance * tolerance);
	}

	function drawGrid() {
		if (!ctx || !gridData || !xScale || !yScale) {
			console.log('Missing required data for drawing:', { ctx: !!ctx, gridData: !!gridData, xScale: !!xScale, yScale: !!yScale });
			return;
		}

		const context = ctx;
		
		// Clear the canvas
		context.clearRect(0, 0, width, height);
		context.save();

		// Apply zoom transform
		context.translate(zoomTransform.x, zoomTransform.y);
		context.scale(zoomTransform.k, zoomTransform.k);

		// Apply coordinate system transformations
		if (coordSystemInfo) {
			context.translate(width / 2, height / 2);
			if (coordSystemInfo.rotation !== 0) {
				context.rotate((coordSystemInfo.rotation * Math.PI) / 180);
			}
			if (coordSystemInfo.needsYInversion) {
				context.scale(1, -1);
			}
			context.translate(-width / 2, -height / 2);
		}

		// Draw lines first
		context.lineWidth = 0.25;
		context.strokeStyle = 'orange';
		
		// Batch line drawing operations
		context.beginPath();
		gridData.lines.forEach((line) => {
			context.moveTo(xScale(line.points[0].longitude), yScale(line.points[0].latitude));
			context.lineTo(xScale(line.points[1].longitude), yScale(line.points[1].latitude));
		});
		context.stroke();

		// Draw components based on filter
		const visibleComponents = gridData.components.filter(comp => 
			!selectedComponentTypes.size || selectedComponentTypes.has(comp.type)
		);

		// Batch component drawing operations
		visibleComponents.forEach((component) => {
			if (!component.hasLocation) return;
			
			const baseX = xScale(component.location.longitude);
			const baseY = yScale(component.location.latitude);
			const { x, y } = getOffsetPosition(baseX, baseY, component.id);

			if (component.type === 'ACLineSegment') {
				// Find connected line for ACLineSegment
				const connectedLine = gridData.lines.find(line => 
					coordinatesMatch(line.points[0], component.location) || 
					coordinatesMatch(line.points[1], component.location)
				);

				if (connectedLine) {
					context.beginPath();
					context.moveTo(xScale(connectedLine.points[0].longitude), yScale(connectedLine.points[0].latitude));
					context.lineTo(xScale(connectedLine.points[1].longitude), yScale(connectedLine.points[1].latitude));
					context.strokeStyle = '#ff0000';
					context.lineWidth = 0.25;
					context.stroke();
				}
			} else {
				const { shape, color, size } = getComponentShape(component.type, zoomTransform.k);
				context.fillStyle = color;
				context.beginPath();

				if (shape === 'circle' && Array.isArray(size)) {
					context.arc(x, y, size[0], 0, 2 * Math.PI);
					context.fill();
				} else if (shape === 'rect' && Array.isArray(size)) {
					context.fillRect(x - size[0] / 2, y - size[1] / 2, size[0], size[1]);
				} else if (shape === 'polygon' && Array.isArray(size)) {
					// Draw parallelogram
					const width = size[0];
					const height = size[1];
					const skew = width * 0.3; // Skew factor for parallelogram

					context.beginPath();
					context.moveTo(x - width/2 + skew, y - height/2); // Top left
					context.lineTo(x + width/2 + skew, y - height/2); // Top right
					context.lineTo(x + width/2 - skew, y + height/2); // Bottom right
					context.lineTo(x - width/2 - skew, y + height/2); // Bottom left
					context.closePath();
					context.fill();
				}
			}
		});

		context.restore();
	}

	function setupCanvas() {
		if (!canvas) return;
		
		ctx = canvas.getContext('2d');
		if (!ctx) return;

		zoomInstance = d3.zoom()
			.scaleExtent([0.5, 10])
			.on('zoom', (event: d3.D3ZoomEvent<HTMLCanvasElement, unknown>) => {
				if (zoomTimeout) cancelAnimationFrame(zoomTimeout);
				zoomTimeout = requestAnimationFrame(() => {
					zoomScale = event.transform.k;
					zoomTransform = event.transform;
					zoomPercentage = Math.round(zoomScale * 100);
					drawGrid();
					// Update popup positions after zoom
					if (popup.show) {
						updatePopupPosition();
					}
					if (detailPopup.show) {
						updateDetailPopupPosition();
					}
				});
			});

		d3.select(canvas)
			.call(zoomInstance)
			.on('click', (event: MouseEvent) => {
				if (event.ctrlKey || !gridData || !canvas || !xScale || !yScale) return;
				showFilters = false;
				showLegend = false;
				checkClick(event);
			});
	}

	function checkClick(event: MouseEvent) {
		if (event.ctrlKey || !gridData || !canvas || !xScale || !yScale) return;

		const rect = canvas.getBoundingClientRect();
		const clickX = event.clientX - rect.left;
		const clickY = event.clientY - rect.top;

		// Transform click coordinates to account for zoom and pan
		let transformedX = (clickX - zoomTransform.x) / zoomTransform.k;
		let transformedY = (clickY - zoomTransform.y) / zoomTransform.k;

		// Apply coordinate system transformations to click coordinates
		if (coordSystemInfo) {
			// Move to center for rotation
			transformedX -= width / 2;
			transformedY -= height / 2;
			
			// Apply rotation if needed
			if (coordSystemInfo.rotation !== 0) {
				const angle = (coordSystemInfo.rotation * Math.PI) / 180;
				const cosAngle = Math.cos(-angle);
				const sinAngle = Math.sin(-angle);
				const newX = transformedX * cosAngle - transformedY * sinAngle;
				const newY = transformedX * sinAngle + transformedY * cosAngle;
				transformedX = newX;
				transformedY = newY;
			}
			
			// Apply Y inversion if needed
			if (coordSystemInfo.needsYInversion) {
				transformedY = -transformedY;
			}
			
			// Move back from center
			transformedX += width / 2;
			transformedY += height / 2;
		}

		const baseClickRadius = 20;
		const clickRadius = baseClickRadius / zoomTransform.k;

		const clickedNodes = gridData.components
			.filter(comp => {
				if (!comp.hasLocation) return false;
				// Only include components that match the current filter
				if (selectedComponentTypes.size && !selectedComponentTypes.has(comp.type)) return false;

				const nodeX = xScale(comp.location.longitude);
				const nodeY = yScale(comp.location.latitude);

				const dx = transformedX - nodeX;
				const dy = transformedY - nodeY;
				const distance = Math.sqrt(dx * dx + dy * dy);

				return distance <= clickRadius;
			})
			.map(comp => ({
				...comp,
				screenX: clickX,
				screenY: clickY
			}));

		if (clickedNodes.length > 0) {
			popup = {
				show: true,
				x: clickX,
				y: clickY,
				nodes: clickedNodes
			};
		} else {
			popup.show = false;
			detailPopup.show = false;
		}
	}

	function updatePopupPosition() {
		if (!canvas || !popup.show) return;
		const rect = canvas.getBoundingClientRect();
		popup = {
			...popup,
			x: popup.x,
			y: popup.y
		};
	}

	function updateDetailPopupPosition() {
		if (!canvas || !detailPopup.show || !detailPopup.node) return;
		const rect = canvas.getBoundingClientRect();
		const screenX = rect.left + zoomTransform.applyX(xScale(detailPopup.node.location.longitude));
		const screenY = rect.top + zoomTransform.applyY(yScale(detailPopup.node.location.latitude));
		detailPopup = {
			...detailPopup,
			x: screenX - rect.left,
			y: screenY - rect.top
		};
	}

	async function showNodeDetails(node: Component) {
		if (!canvas || !xScale || !yScale) return;

		const rect = canvas.getBoundingClientRect();
		const screenX = rect.left + zoomTransform.applyX(xScale(node.location.longitude));
		const screenY = rect.top + zoomTransform.applyY(yScale(node.location.latitude));

		detailPopup = {
			show: true,
			x: screenX - rect.left,
			y: screenY - rect.top,
			node: node
		};
		//popup.show = false;

		// Fetch component details
		isLoadingDetails = true;
		errorMessage = null;
		try {
			const details = await getComponentDetails(node.id, node.type as CIMComponentType);
			selectedComponent = {
				...node,
				additionalDetails: details
			};
		} catch (error) {
			console.error('Error fetching component details:', error);
			errorMessage = error instanceof Error ? error.message : 'Failed to load component details';
			selectedComponent = node;
		} finally {
			isLoadingDetails = false;
		}
	}

	function closePopup() {
		popup.show = false;
	}

	function closeDetailPopup() {
		detailPopup.show = false;
	}

	function formatPropertyName(key: string): string {
		return key
			.replace(/([A-Z])/g, ' $1') // Insert space before capital letters
			.replace(/^./, str => str.toUpperCase()); // Capitalize first letter
	}

	function formatNumber(value: number): string {
		if (value === null || value === undefined) return 'N/A';
		if (Math.abs(value) < 0.0001 && value !== 0) return value.toExponential(4);
		if (Math.abs(value) >= 10000) return value.toExponential(4);
		return Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
	}

	function calculateTotalMatrix(matrix: number[][], lineLength: number): (number | null)[][] {
		return matrix.map(row => row.map(value => isValidValue(value) ? value * lineLength : null));
	}

	function calculateImpedance(r: any, x: any): { magnitude: number; angle: number } | null {
		if (!isValidValue(r) || !isValidValue(x)) return null;
		const magnitude = Math.sqrt(r * r + x * x);
		const angle = Math.atan2(x, r) * (180 / Math.PI);
		return { magnitude, angle };
	}

	function getMatrixValue(matrix: (number | null)[][], i: number, j: number): number | null {
		return matrix[i][j];
	}

	function isValidValue(value: any): boolean {
		return value !== null && 
			   value !== undefined && 
			   value !== 'N/A' && 
			   !(typeof value === 'number' && isNaN(value));
	}

	function addPropertyIfValid(name: string, value: any, unit: string = ''): string {
		if (!isValidValue(value)) return '';
		return `
			<div class="property">
				<span class="property-name">${name}:</span>
				<span class="property-value">${value}${unit ? ' ' + unit : ''}</span>
			</div>
		`;
	}

	function groupMeasurementsByType(measurements: any[]): Record<string, any[]> {
		const measurementsByType: Record<string, any[]> = {};
		
		measurements.forEach((measurement) => {
			const typeKey = measurement.measurementType || measurement.type;
			if (!measurementsByType[typeKey]) {
				measurementsByType[typeKey] = [];
			}
			measurementsByType[typeKey].push(measurement);
		});
		
		return measurementsByType;
	}

	function toggleComponentType(type: CIMComponentType) {
		if (selectedComponentTypes.has(type)) {
			selectedComponentTypes.delete(type);
		} else {
			selectedComponentTypes.add(type);
		}
		selectedComponentTypes = selectedComponentTypes; // Trigger reactivity
		drawGrid();
	}

	function clearFilters() {
		selectedComponentTypes.clear();
		selectedComponentTypes = selectedComponentTypes; // Trigger reactivity
		drawGrid();
	}

	function toggleFilters() {
		showFilters = !showFilters;
	}

	function toggleLegend() {
		showLegend = !showLegend;
	}

	function getComponentsAtLocation(location: Location): Component[] {
		const key = `${location.longitude.toFixed(4)},${location.latitude.toFixed(4)}`;
		if (coordinateCache.has(key)) {
			return coordinateCache.get(key)!;
		}
		
		const components = gridData.components.filter(comp => 
			comp.hasLocation && coordinatesMatch(comp.location, location)
		);
		coordinateCache.set(key, components);
		return components;
	}

	function clearCoordinateCache() {
		coordinateCache.clear();
	}

	onMount(() => {
		resizeCanvas();
		window.addEventListener("resize", handleResize);
		setupCanvas();
		return () => {
			window.removeEventListener("resize", handleResize);
			if (zoomTimeout) cancelAnimationFrame(zoomTimeout);
			if (updateTimeout) clearTimeout(updateTimeout);
			if (resizeTimeout) clearTimeout(resizeTimeout);
		};
	});
</script>

<div class="canvas-container">
	{#if isLoadingGrid}
		<div class="loading-overlay">
			<div class="loading-spinner"></div>
			<div class="loading-text">Loading grid data...</div>
		</div>
	{/if}
	<canvas bind:this={canvas} {width} {height}></canvas>

	{#if gridData && !isLoadingGrid}
		<div class="zoom-controls">
			<button class="zoom-button" on:click={zoomIn}>+</button>
			<span class="zoom-percentage">{zoomPercentage}%</span>
			<button class="zoom-button" on:click={zoomOut}>-</button>
			<button class="reset-button" on:click={resetZoom}>Reset</button>
		</div>

		<button class="toggle-button filters-toggle" on:click={toggleFilters}>
			{showFilters ? 'Hide Filters' : 'Show Filters'}
		</button>

		{#if showFilters}
			<div class="filter-controls">
				<h4>Filter Components</h4>
				<div class="filter-buttons">
					{#each allComponentTypes as type}
						<button 
							class="filter-button" 
							class:active={selectedComponentTypes.has(type)}
							on:click={() => toggleComponentType(type)}
						>
							{type}
						</button>
					{/each}
				</div>
				{#if selectedComponentTypes.size > 0}
					<button class="clear-filters" on:click={clearFilters}>Clear Filters</button>
				{/if}
			</div>
		{/if}

		<button class="toggle-button legend-toggle" on:click={toggleLegend}>
			{showLegend ? 'Hide Legend' : 'Show Legend'}
		</button>

		{#if showLegend}
			<div class="legend">
				<h4>Component Types</h4>
				<div class="legend-items">
					{#each allComponentTypes as type}
						<div class="legend-item">
							<div class="legend-symbol" style="background-color: {getComponentColor(type)};"></div>
							<span>{type}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	{/if}

	{#if popup.show}
		<div class="popup" style="left: {popup.x}px; top: {popup.y}px;">
			<h3>Nodes at this location ({popup.nodes.length})</h3>
			<div class="popup-content">
				{#each popup.nodes as node}
					<div class="node-item" on:click={() => showNodeDetails(node)}>
						<p>Type: {node.type}</p>
						<p>ID: {node.id}</p>
					</div>
				{/each}
			</div>
			<div class="popup-footer">
				<button on:click={closePopup}>Close</button>
			</div>
		</div>
	{/if}

	{#if detailPopup.show}
		<div class="detail-overlay">
			<div class="detail-panel">
				<button class="close-btn" on:click={closeDetailPopup}>×</button>
				{#if isLoadingDetails}
					<div class="loading">Loading details...</div>
				{:else if errorMessage}
					<div class="error-message">{errorMessage}</div>
				{:else if selectedComponent}
					<h3>{selectedComponent.name || 'Unnamed Component'}</h3>
					<div class="property-group">
						<div class="property">
							<span class="property-name">Type:</span>
							<span class="property-value">{selectedComponent.type}</span>
						</div>
						<div class="property">
							<span class="property-name">ID:</span>
							<span class="property-value">{selectedComponent.id}</span>
						</div>
					</div>

					{#if selectedComponent.additionalDetails}
						{#if selectedComponent.type === CIMComponentTypes.ACLineSegment}
							{#if selectedComponent.additionalDetails.description}
								<div class="property-group">
									<div class="property">
										<span class="property-name">Description:</span>
										<span class="property-value">{selectedComponent.additionalDetails.description}</span>
									</div>
								</div>
							{/if}

							{#if selectedComponent.additionalDetails.inService !== undefined || selectedComponent.additionalDetails.normallyInService !== undefined}
								<div class="property-group">
									<h3>Operational Status</h3>
									{#if selectedComponent.additionalDetails.inService !== undefined}
										<div class="property">
											<span class="property-name">In Service:</span>
											<span class="property-value">{selectedComponent.additionalDetails.inService ? 'Yes' : 'No'}</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.normallyInService !== undefined}
										<div class="property">
											<span class="property-name">Normally In Service:</span>
											<span class="property-value">{selectedComponent.additionalDetails.normallyInService ? 'Yes' : 'No'}</span>
										</div>
									{/if}
								</div>
							{/if}

							{#if selectedComponent.additionalDetails.electricalParameters}
								<div class="property-group">
									<h3>Electrical Parameters</h3>
									{#if selectedComponent.additionalDetails.electricalParameters.length && isValidValue(selectedComponent.additionalDetails.electricalParameters.length.value)}
										<div class="property">
											<span class="property-name">Length:</span>
											<span class="property-value">
												{formatNumber(selectedComponent.additionalDetails.electricalParameters.length.value)}
												{selectedComponent.additionalDetails.electricalParameters.length.unit}
											</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.electricalParameters.nominalVoltage && isValidValue(selectedComponent.additionalDetails.electricalParameters.nominalVoltage.value)}
										<div class="property">
											<span class="property-name">Nominal Voltage:</span>
											<span class="property-value">
												{formatNumber(selectedComponent.additionalDetails.electricalParameters.nominalVoltage.value)}
												{selectedComponent.additionalDetails.electricalParameters.nominalVoltage.unit}
											</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.electricalParameters.ratedCurrent && isValidValue(selectedComponent.additionalDetails.electricalParameters.ratedCurrent.value)}
										<div class="property">
											<span class="property-name">Rated Current:</span>
											<span class="property-value">
												{formatNumber(selectedComponent.additionalDetails.electricalParameters.ratedCurrent.value)}
												{selectedComponent.additionalDetails.electricalParameters.ratedCurrent.unit}
											</span>
										</div>
									{/if}

									{#if selectedComponent.additionalDetails.electricalParameters.impedance && (isValidValue(selectedComponent.additionalDetails.electricalParameters.impedance.r.value) || isValidValue(selectedComponent.additionalDetails.electricalParameters.impedance.x.value)) 	}
										<h5>Impedance</h5>
										{#if selectedComponent.additionalDetails.electricalParameters.impedance.r}
											<div class="property">
												<span class="property-name">Resistance (R):</span>
												<span class="property-value">
													{formatNumber(selectedComponent.additionalDetails.electricalParameters.impedance.r.value)}
													{selectedComponent.additionalDetails.electricalParameters.impedance.r.unit}
												</span>
											</div>
										{/if}
										{#if selectedComponent.additionalDetails.electricalParameters.impedance.x}
											<div class="property">
												<span class="property-name">Reactance (X):</span>
												<span class="property-value">
													{formatNumber(selectedComponent.additionalDetails.electricalParameters.impedance.x.value)}
													{selectedComponent.additionalDetails.electricalParameters.impedance.x.unit}
												</span>
											</div>
										{/if}
									{/if}

									{#if selectedComponent.additionalDetails.electricalParameters.admittance && (isValidValue(selectedComponent.additionalDetails.electricalParameters.admittance.bch.value) || isValidValue(selectedComponent.additionalDetails.electricalParameters.admittance.gch.value))}
										<h5>Admittance</h5>
										{#if selectedComponent.additionalDetails.electricalParameters.admittance.bch}
											<div class="property">
												<span class="property-name">Susceptance (B<sub>ch</sub>):</span>
												<span class="property-value">
													{formatNumber(selectedComponent.additionalDetails.electricalParameters.admittance.bch.value)}
													{selectedComponent.additionalDetails.electricalParameters.admittance.bch.unit}
												</span>
											</div>
										{/if}
										{#if selectedComponent.additionalDetails.electricalParameters.admittance.gch}
											<div class="property">
												<span class="property-name">Conductance (G<sub>ch</sub>):</span>
												<span class="property-value">
													{formatNumber(selectedComponent.additionalDetails.electricalParameters.admittance.gch.value)}
													{selectedComponent.additionalDetails.electricalParameters.admittance.gch.unit}
												</span>
											</div>
										{/if}
									{/if}
								</div>
							{/if}

							{#if selectedComponent.additionalDetails.electricalParameters && 
								selectedComponent.additionalDetails.electricalParameters.length && 
								(selectedComponent.additionalDetails.perLengthImpedance || selectedComponent.additionalDetails.phaseImpedance)}
								{@const lineLength = selectedComponent.additionalDetails.electricalParameters.length.value}
								{@const lineLengthUnit = selectedComponent.additionalDetails.electricalParameters.length.unit}
								<div class="property-group calculation-group">
									<h4 class="calculation-header">Calculated Line Values</h4>
									<div class="property note">
										<em>Note: These values are calculated based on the per-length parameters and line length ({lineLength} {lineLengthUnit}).</em>
									</div>

									{#if selectedComponent.additionalDetails.perLengthImpedance}
										{#if selectedComponent.additionalDetails.perLengthImpedance.positiveSequence}
											{@const seq = selectedComponent.additionalDetails.perLengthImpedance.positiveSequence}
											{#if isValidValue(seq.r.value) && isValidValue(seq.x.value)}
												<h5>Positive Sequence Impedance (Calculated)</h5>
												{@const totalR = seq.r.value * lineLength}
												{@const totalX = seq.x.value * lineLength}
												{@const totalZ = Math.sqrt(totalR * totalR + totalX * totalX)}
												{@const zAngle = Math.atan2(totalX, totalR) * (180 / Math.PI)}
												<div class="property">
													<span class="property-name">Total R+:</span>
													<span class="property-value">{formatNumber(totalR)} Ω</span>
												</div>
												<div class="property">
													<span class="property-name">Total X+:</span>
													<span class="property-value">{formatNumber(totalX)} Ω</span>
												</div>
												<div class="property">
													<span class="property-name">Total Z+ Magnitude:</span>
													<span class="property-value">{formatNumber(totalZ)} Ω</span>
												</div>
												<div class="property">
													<span class="property-name">Z+ Angle:</span>
													<span class="property-value">{formatNumber(zAngle)} °</span>
												</div>
											{/if}

											{#if isValidValue(seq.bch.value) && isValidValue(seq.gch.value)}
												<h5>Positive Sequence Admittance (Calculated)</h5>
												{@const totalB = seq.bch.value * lineLength}
												{@const totalG = seq.gch.value * lineLength}
												{@const totalY = Math.sqrt(totalB * totalB + totalG * totalG)}
												{@const yAngle = Math.atan2(totalB, totalG) * (180 / Math.PI)}
												<div class="property">
													<span class="property-name">Total G+:</span>
													<span class="property-value">{formatNumber(totalG)} S</span>
												</div>
												<div class="property">
													<span class="property-name">Total B+:</span>
													<span class="property-value">{formatNumber(totalB)} S</span>
												</div>
												<div class="property">
													<span class="property-name">Total Y+ Magnitude:</span>
													<span class="property-value">{formatNumber(totalY)} S</span>
												</div>
												<div class="property">
													<span class="property-name">Y+ Angle:</span>
													<span class="property-value">{formatNumber(yAngle)} °</span>
												</div>
											{/if}
										{/if}

										{#if selectedComponent.additionalDetails.perLengthImpedance.zeroSequence}
											{@const seq = selectedComponent.additionalDetails.perLengthImpedance.zeroSequence}
											{#if isValidValue(seq.r.value) && isValidValue(seq.x.value)}
												<h5>Zero Sequence Impedance (Calculated)</h5>
												{@const totalR = seq.r.value * lineLength}
												{@const totalX = seq.x.value * lineLength}
												{@const totalZ = Math.sqrt(totalR * totalR + totalX * totalX)}
												{@const zAngle = Math.atan2(totalX, totalR) * (180 / Math.PI)}
												<div class="property">
													<span class="property-name">Total R0:</span>
													<span class="property-value">{formatNumber(totalR)} Ω</span>
												</div>
												<div class="property">
													<span class="property-name">Total X0:</span>
													<span class="property-value">{formatNumber(totalX)} Ω</span>
												</div>
												<div class="property">
													<span class="property-name">Total Z0 Magnitude:</span>
													<span class="property-value">{formatNumber(totalZ)} Ω</span>
												</div>
												<div class="property">
													<span class="property-name">Z0 Angle:</span>
													<span class="property-value">{formatNumber(zAngle)} °</span>
												</div>
											{/if}

											{#if isValidValue(seq.bch.value) && isValidValue(seq.gch.value)}
												<h5>Zero Sequence Admittance (Calculated)</h5>
												{@const totalB = seq.bch.value * lineLength}
												{@const totalG = seq.gch.value * lineLength}
												{@const totalY = Math.sqrt(totalB * totalB + totalG * totalG)}
												{@const yAngle = Math.atan2(totalB, totalG) * (180 / Math.PI)}
												<div class="property">
													<span class="property-name">Total G0:</span>
													<span class="property-value">{formatNumber(totalG)} S</span>
												</div>
												<div class="property">
													<span class="property-name">Total B0:</span>
													<span class="property-value">{formatNumber(totalB)} S</span>
												</div>
												<div class="property">
													<span class="property-name">Total Y0 Magnitude:</span>
													<span class="property-value">{formatNumber(totalY)} S</span>
												</div>
												<div class="property">
													<span class="property-name">Y0 Angle:</span>
													<span class="property-value">{formatNumber(yAngle)} °</span>
												</div>
											{/if}
										{/if}
									{/if}

									{#if selectedComponent.additionalDetails.phaseImpedance && 
										selectedComponent.additionalDetails.phaseImpedance.matrices && 
										selectedComponent.additionalDetails.phaseImpedance.matrices.resistance?.value?.length > 0 && 
										selectedComponent.additionalDetails.phaseImpedance.matrices.reactance?.value?.length > 0}
										<h5>Phase Impedance Matrix Calculations</h5>
										<div class="property">
											<span class="property-name">Calculation Method:</span>
											<span class="property-value">Matrix elements multiplied by line length</span>
										</div>

										{@const rMatrix = selectedComponent.additionalDetails.phaseImpedance.matrices.resistance.value}
										{@const xMatrix = selectedComponent.additionalDetails.phaseImpedance.matrices.reactance.value}
										{@const totalRMatrix = calculateTotalMatrix(rMatrix, lineLength)}
										{@const totalXMatrix = calculateTotalMatrix(xMatrix, lineLength)}

										<details>
											<summary>View Total Phase Impedance Matrices</summary>
											<div class="matrix-container">
												<h6>Total R Matrix (Ω)</h6>
												<table class="matrix-table">
													<tbody>
														{#each totalRMatrix as row}
															<tr>
																{#each row as cell}
																	<td>{isValidValue(cell) ? formatNumber(cell) : 'N/A'}</td>
																{/each}
															</tr>
														{/each}
													</tbody>
												</table>
											</div>
											
											<div class="matrix-container">
												<h6>Total X Matrix (Ω)</h6>
												<table class="matrix-table">
													<tbody>
														{#each totalXMatrix as row}
															<tr>
																{#each row as cell}
																	<td>{isValidValue(cell) ? formatNumber(cell) : 'N/A'}</td>
																{/each}
															</tr>
														{/each}
													</tbody>
												</table>
											</div>
										</details>

										{#if totalRMatrix.length > 0 && totalXMatrix.length > 0}
											{@const hasDiagonals = Array.from({length: Math.min(totalRMatrix.length, totalXMatrix.length)}, (_, i) => 
												isValidValue(totalRMatrix[i][i]) && isValidValue(totalXMatrix[i][i])
											).some(Boolean)}

											{#if hasDiagonals}
												<h6>Phase Self-Impedances (diagonal elements)</h6>
												{#each Array.from({length: Math.min(totalRMatrix.length, totalXMatrix.length)}) as _, i}
													{#if isValidValue(totalRMatrix[i][i]) && isValidValue(totalXMatrix[i][i])}
														{@const r = totalRMatrix[i][i]}
														{@const x = totalXMatrix[i][i]}
														{@const impedance = calculateImpedance(r, x)}
														{#if impedance}
															<div class="property">
																<span class="property-name">Phase {i + 1} Z:</span>
																<span class="property-value">{formatNumber(impedance.magnitude)} ∠ {formatNumber(impedance.angle)}° Ω</span>
															</div>
														{/if}
													{/if}
												{/each}
											{/if}
										{/if}
									{/if}
								</div>
							{/if}

							{#if selectedComponent.additionalDetails.phaseImpedance && selectedComponent.additionalDetails.phaseImpedance.matrices}
								{@const matrices = selectedComponent.additionalDetails.phaseImpedance.matrices}
								{@const hasValidMatrix =
								(matrices.resistance?.value?.length > 0 &&
								  matrices.resistance.value.some((row) =>
									row.some((val) => isValidValue(val))
								  )) ||
								(matrices.reactance?.value?.length > 0 &&
								  matrices.reactance.value.some((row) =>
									row.some((val) => isValidValue(val))
								  )) ||
								(matrices.susceptance?.value?.length > 0 &&
								  matrices.susceptance.value.some((row) =>
									row.some((val) => isValidValue(val))
								  )) ||
								(matrices.conductance?.value?.length > 0 &&
								  matrices.conductance.value.some((row) =>
									row.some((val) => isValidValue(val))
								  ))}
								{#if hasValidMatrix}
								
									<div class="property-group">
										<h3>Phase Impedance Matrix</h3>
										<div class="property">
											<span class="property-name">Name:</span>
											<span class="property-value">{
											  selectedComponent.additionalDetails.phaseImpedance.name || "Phase Impedance"
											}</span>
										</div>
										<div class="property">
											<span class="property-name">Number of Phases:</span>
											<span class="property-value">{selectedComponent.additionalDetails.phaseImpedance.numPhases}</span>
										</div>
										{#if matrices.resistance?.value?.length > 0}
											<div class="matrix-container">
												<h5>Resistance (R) Matrix ({matrices.resistance.unit})</h5>
												<table class="matrix-table">
													<tbody>
														{#each matrices.resistance.value as row}
															<tr>
																{#each row as cell}
																	<td>{isValidValue(cell) ? formatNumber(cell) : 'N/A'}</td>
																{/each}
															</tr>
														{/each}
													</tbody>
												</table>
											</div>
										{/if}
										{#if matrices.reactance?.value?.length > 0}
											<div class="matrix-container">
												<h5>Reactance (X) Matrix ({matrices.reactance.unit})</h5>
												<table class="matrix-table">
													<tbody>
														{#each matrices.reactance.value as row}
															<tr>
																{#each row as cell}
																	<td>{isValidValue(cell) ? formatNumber(cell) : 'N/A'}</td>
																{/each}
															</tr>
														{/each}
													</tbody>
												</table>
											</div>
										{/if}
										{#if matrices.susceptance?.value?.length > 0}
											<div class="matrix-container">
												<h5>Susceptance (B) Matrix  ({matrices.susceptance.unit})</h5>
												<table class="matrix-table">
													<tbody>
														{#each matrices.susceptance.value as row}
															<tr>
																{#each row as cell}
																	<td>{isValidValue(cell) ? formatNumber(cell) : 'N/A'}</td>
																{/each}
															</tr>
														{/each}
													</tbody>
												</table>
											</div>
										{/if}
									</div>
								{/if}
							{/if}

							{#if selectedComponent.additionalDetails.perLengthImpedance}
								{@const pli = selectedComponent.additionalDetails.perLengthImpedance}
								{@const hasValidData =
							  (pli.positiveSequence &&
								(isValidValue(pli.positiveSequence.r?.value) ||
								  isValidValue(pli.positiveSequence.x?.value) ||
								  isValidValue(pli.positiveSequence.bch?.value) ||
								  isValidValue(pli.positiveSequence.gch?.value))) ||
							  (pli.zeroSequence &&
								(isValidValue(pli.zeroSequence.r?.value) ||
								  isValidValue(pli.zeroSequence.x?.value) ||
								  isValidValue(pli.zeroSequence.bch?.value) ||
								  isValidValue(pli.zeroSequence.gch?.value)))
								}
								{#if hasValidData}
									<div class="property-group">
										<h3>Per-Length Impedance</h3>
										<div class="property">
										<span class="property-name">Name:</span>
										<span class="property-value">{
										  selectedComponent.additionalDetails.perLengthImpedance.name
										}</span>
										</div>

										{#if selectedComponent.additionalDetails.perLengthImpedance.positiveSequence}
											{@const seq = selectedComponent.additionalDetails.perLengthImpedance.positiveSequence}
											<h5>Positive Sequence</h5>
											{#if isValidValue(seq.r?.value)}
												<div class="property">
													<span class="property-name">R+:</span>
													<span class="property-value">{formatNumber(seq.r.value)} {seq.r.unit}</span>
												</div>
											{/if}
											{#if isValidValue(seq.x?.value)}
												<div class="property">
													<span class="property-name">X+:</span>
													<span class="property-value">{formatNumber(seq.x.value)} {seq.x.unit}</span>
												</div>
											{/if}
										{/if}
										{#if selectedComponent.additionalDetails.perLengthImpedance.zeroSequence}
											{@const seq = selectedComponent.additionalDetails.perLengthImpedance.zeroSequence}
											<h5>Zero Sequence</h5>
											{#if isValidValue(seq.r?.value)}
												<div class="property">
													<span class="property-name">R0:</span>
													<span class="property-value">{formatNumber(seq.r.value)} {seq.r.unit}</span>
												</div>
											{/if}
											{#if isValidValue(seq.x?.value)}
												<div class="property">
													<span class="property-name">X0:</span>
													<span class="property-value">{formatNumber(seq.x.value)} {seq.x.unit}</span>
												</div>
											{/if}
										{/if}
									</div>
								{/if}
							{/if}

							{#if selectedComponent.additionalDetails.connectivity}
								{@const connectivity = selectedComponent.additionalDetails.connectivity}
								{@const hasValidConnectivity =
									(connectivity.fromNode &&
									(isValidValue(connectivity.fromNode.name) ||
										isValidValue(connectivity.fromNode.id) ||
										isValidValue(connectivity.fromNode.busName))) ||
									(connectivity.toNode &&
									(isValidValue(connectivity.toNode.name) ||
										isValidValue(connectivity.toNode.id) ||
										isValidValue(connectivity.toNode.busName)))
									}
							{#if hasValidConnectivity}
								<div class="property-group">
									<h3>Node Connectivity</h3>
									<div class="scrollable-content">
										{#if connectivity.fromNode}
											<h5>From Node</h5>
											<div class="property">
												<span class="property-name">Name:</span>
												<span class="property-value">{connectivity.fromNode.name}</span>
											</div>
											<div class="property">
												<span class="property-name">ID:</span>
												<span class="property-value">{connectivity.fromNode.id}</span>
											</div>
											<div class="property">
												<span class="property-name">Bus Name:</span>
												<span class="property-value">{connectivity.fromNode.busName}</span>
											</div>
											
										{/if}
										{#if connectivity.toNode}
											<h5>To Node</h5>
											<div class="property">
												<span class="property-name">Name:</span>
												<span class="property-value">{connectivity.toNode.name}</span>
											</div>
											<div class="property">
												<span class="property-name">ID:</span>
												<span class="property-value">{connectivity.toNode.id}</span>
											</div>
											<div class="property">
												<span class="property-name">Bus Name:</span>
												<span class="property-value">{connectivity.toNode.busName}</span>
											</div>
										
										{/if}
									</div>
								</div>
							{/if}
							{/if}
							{#if selectedComponent.additionalDetails.measurements && selectedComponent.additionalDetails.measurements.length > 0}
								<div class="property-group">
									<h3>Measurements ({selectedComponent.additionalDetails.measurements.length})</h3>
									<div class="scrollable-content">
										{#each Object.entries(groupMeasurementsByType(selectedComponent.additionalDetails.measurements)) as [type, meas]}
											<h5>{formatPropertyName(type)} ({meas.length})</h5>
											{#each meas as m}
												<div class="property">
													<span class="property-name">{m.name}:</span>
													<span class="property-value">{m.unit ? m.unit : "No unit"}</span>
												</div>
											{/each}
										{/each}
									</div>
								</div>
							{/if}
						
						
						
						{:else if selectedComponent.type === CIMComponentTypes.PowerTransformer}
							{#if selectedComponent.additionalDetails.details && Object.keys(selectedComponent.additionalDetails.details).length > 0}
								<div class="property-group">
									<h3>Operational Details</h3>
									{#each Object.entries(selectedComponent.additionalDetails.details) as [key, value]}
										{#if isValidValue(value)}
											<div class="property">
												<span class="property-name">{formatPropertyName(key)}:</span>
												<span class="property-value">{value}</span>
											</div>
										{/if}
									{/each}
								</div>
							{/if}

							{#if (selectedComponent.additionalDetails.tankInfo && selectedComponent.additionalDetails.tankInfo.length > 0) || 
								(selectedComponent.additionalDetails.tanks && selectedComponent.additionalDetails.tanks.length > 0)}
								<div class="property-group">
									<h3>Transformer Tank Details</h3>
									{#if selectedComponent.additionalDetails.tankInfo || selectedComponent.additionalDetails.tanks}
										{#each (selectedComponent.additionalDetails.tankInfo || selectedComponent.additionalDetails.tanks || []) as tank, index}
											{#if index > 0}
												<hr class="tank-separator">
											{/if}
											<div class="property">
												<span class="property-name">Tank Name:</span>
												<span class="property-value">{tank.name || "Unknown"}</span>
											</div>
											<div class="property">
												<span class="property-name">Tank ID:</span>
												<span class="property-value">{tank.id || "Unknown"}</span>
											</div>
											{#if tank.description}
												<div class="property">
													<span class="property-name">Description:</span>
													<span class="property-value">{tank.description}</span>
												</div>
											{/if}
											{#if tank.windingInsulationType}
												<div class="property">
													<span class="property-name">Winding Insulation:</span>
													<span class="property-value">{tank.windingInsulationType}</span>
												</div>
											{/if}
											{#if tank.windingRiseTemperature}
												<div class="property">
													<span class="property-name">Winding Rise Temp:</span>
													<span class="property-value">{tank.windingRiseTemperature}</span>
												</div>
											{/if}
										{/each}
									{/if}
								</div>
							{/if}

							{#if selectedComponent.additionalDetails.electricalParameters}
								{#if selectedComponent.additionalDetails.electricalParameters.ratings && 
									Object.keys(selectedComponent.additionalDetails.electricalParameters.ratings).length > 0}
									<div class="property-group">
										<h3>Power & Current Ratings</h3>
										{#each Object.entries(selectedComponent.additionalDetails.electricalParameters.ratings) as [key, value]}
											{#if isValidValue(value)}

												<div class="property">
													<span class="property-name">{formatPropertyName(key)}:</span>
													<span class="property-value">{value}</span>
												</div>
											{/if}
										{/each}
									</div>
								{/if}

								{#if selectedComponent.additionalDetails.electricalParameters.impedance && 
									Object.keys(selectedComponent.additionalDetails.electricalParameters.impedance).length > 0}
									<div class="property-group">
										<h3>Impedance & Reactance</h3>
										{#each Object.entries(selectedComponent.additionalDetails.electricalParameters.impedance) as [key, value]}
											{#if isValidValue(value)}
											<div class="property">
												<span class="property-name">{formatPropertyName(key)}:</span>
												<span class="property-value">{value}</span>
											</div>
											{/if}
										{/each}
									</div>
								{/if}

								{#if selectedComponent.additionalDetails.electricalParameters.connections && 
									Object.keys(selectedComponent.additionalDetails.electricalParameters.connections).length > 0}
									<div class="property-group">
										<h3>Connection Configuration</h3>
										{#each Object.entries(selectedComponent.additionalDetails.electricalParameters.connections) as [key, value]}
											{#if isValidValue(value)}
											<div class="property">
												<span class="property-name">{formatPropertyName(key)}:</span>
												<span class="property-value">{value}</span>
											</div>
											{/if}
										{/each}
									</div>
								{/if}

								{#if selectedComponent.additionalDetails.electricalParameters.other && 
									Object.keys(selectedComponent.additionalDetails.electricalParameters.other).length > 0}
									<div class="property-group">
										<h3>Other Electrical Parameters</h3>
										{#each Object.entries(selectedComponent.additionalDetails.electricalParameters.other) as [key, value]}
											{#if isValidValue(value)}
											<div class="property">
												<span class="property-name">{formatPropertyName(key)}:</span>
												<span class="property-value">{value}</span>
											</div>
											{/if}
										{/each}
									</div>
								{/if}
							{/if}

							{#if selectedComponent.additionalDetails.connectedEquipment && 
								selectedComponent.additionalDetails.connectedEquipment.length > 0}
								<div class="property-group">
									<h3>Connected Equipment</h3>
									<ul class="connected-equipment">
										{#each selectedComponent.additionalDetails.connectedEquipment as equipment}
											<li>{equipment.name} ({equipment.type})</li>
										{/each}
									</ul>
								</div>
							{/if}

							{#if selectedComponent.additionalDetails.measurements && 
								selectedComponent.additionalDetails.measurements.length > 0}
								<div class="property-group">
									<h3>Measurements</h3>
									<ul class="measurements">
										{#each Object.entries(groupMeasurementsByType(selectedComponent.additionalDetails.measurements)) as [type, meas]}
											<li class="measurement-type">
												{formatPropertyName(type.split("#").pop())}:
												<ul>
													{#each meas as m}
														<li>
															{m.name}
															{#if m.unit && m.unit !== "unknown"}
																({m.unit})
															{/if}
															{#if m.phases}
																[Phase: {m.phases}]
															{/if}
														</li>
													{/each}
												</ul>
											</li>
										{/each}
									</ul>
								</div>
							{/if}
						{:else if selectedComponent.type === CIMComponentTypes.EnergyConsumer }
							{#if selectedComponent.additionalDetails.description}
								<div class="property-group">
									<div class="property">
										<span class="property-name">Description:</span>
										<span class="property-value">{selectedComponent.additionalDetails.description}</span>
									</div>
								</div>
							{/if}

							{#if selectedComponent.additionalDetails.electricalParameters}
								<div class="property-group">
									<h3>Electrical Parameters</h3>
									{#if selectedComponent.additionalDetails.electricalParameters.activePower && isValidValue(selectedComponent.additionalDetails.electricalParameters.activePower.value)}
										<div class="property">
											<span class="property-name">Active Power (P):</span>
											<span class="property-value">
												{formatNumber(selectedComponent.additionalDetails.electricalParameters.activePower.value)}
												{selectedComponent.additionalDetails.electricalParameters.activePower.unit}
											</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.electricalParameters.reactivePower && isValidValue(selectedComponent.additionalDetails.electricalParameters.reactivePower.value)}
										<div class="property">
											<span class="property-name">Reactive Power (Q):</span>
											<span class="property-value">
												{formatNumber(selectedComponent.additionalDetails.electricalParameters.reactivePower.value)}
												{selectedComponent.additionalDetails.electricalParameters.reactivePower.unit}
											</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.electricalParameters.apparentPower && isValidValue(selectedComponent.additionalDetails.electricalParameters.apparentPower.value)}
										<div class="property">
											<span class="property-name">Apparent Power (S):</span>
											<span class="property-value">
												{formatNumber(selectedComponent.additionalDetails.electricalParameters.apparentPower.value)}
												{selectedComponent.additionalDetails.electricalParameters.apparentPower.unit}
											</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.electricalParameters.fixedActivePower && isValidValue(selectedComponent.additionalDetails.electricalParameters.fixedActivePower.value)}
										<div class="property">
											<span class="property-name">Fixed Active Power:</span>
											<span class="property-value">
												{formatNumber(selectedComponent.additionalDetails.electricalParameters.fixedActivePower.value)}
												{selectedComponent.additionalDetails.electricalParameters.fixedActivePower.unit}
											</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.electricalParameters.fixedReactivePower && isValidValue(selectedComponent.additionalDetails.electricalParameters.fixedReactivePower.value)}
										<div class="property">
											<span class="property-name">Fixed Reactive Power:</span>
											<span class="property-value">
												{formatNumber(selectedComponent.additionalDetails.electricalParameters.fixedReactivePower.value)}
												{selectedComponent.additionalDetails.electricalParameters.fixedReactivePower.unit}
											</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.electricalParameters.nominalVoltage && isValidValue(selectedComponent.additionalDetails.electricalParameters.nominalVoltage.value)}
										<div class="property">
											<span class="property-name">Nominal Voltage:</span>
											<span class="property-value">
												{formatNumber(selectedComponent.additionalDetails.electricalParameters.nominalVoltage.value)}
												{selectedComponent.additionalDetails.electricalParameters.nominalVoltage.unit}
											</span>
										</div>
									{/if}

									{#if selectedComponent.additionalDetails.electricalParameters.activePower && selectedComponent.additionalDetails.electricalParameters.reactivePower && 
										isValidValue(selectedComponent.additionalDetails.electricalParameters.activePower.value) && 
										isValidValue(selectedComponent.additionalDetails.electricalParameters.reactivePower.value)}
										{@const p = selectedComponent.additionalDetails.electricalParameters.activePower.value}
										{@const q = selectedComponent.additionalDetails.electricalParameters.reactivePower.value}
										{@const apparentPower = Math.sqrt(p * p + q * q)}
										{@const powerFactor = apparentPower > 0 ? p / apparentPower : 0}
										<div class="property">
											<span class="property-name">Power Factor:</span>
											<span class="property-value">{formatNumber(powerFactor)}</span>
										</div>
									{/if}
								</div>
							{/if}

							{#if selectedComponent.additionalDetails.phaseConfiguration}
								<div class="property-group">
									<h3>Phase Configuration</h3>
									{#if selectedComponent.additionalDetails.phaseConfiguration.phaseConnection && selectedComponent.additionalDetails.phaseConfiguration.phaseConnection !== 'N/A'}
										<div class="property">
											<span class="property-name">Phase Connection:</span>
											<span class="property-value">{selectedComponent.additionalDetails.phaseConfiguration.phaseConnection}</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.phaseConfiguration.phases && selectedComponent.additionalDetails.phaseConfiguration.phases !== 'N/A'}
										<div class="property">
											<span class="property-name">Phases:</span>
											<span class="property-value">{selectedComponent.additionalDetails.phaseConfiguration.phases}</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.phaseConfiguration.grounded === true}
										<div class="property">
											<span class="property-name">Grounded:</span>
											<span class="property-value">Yes</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.phaseConfiguration.earthingIndicator === true}
										<div class="property">
											<span class="property-name">Earthing Indicator:</span>
											<span class="property-value">Yes</span>
										</div>
									{/if}
								</div>
							{/if}

							{#if selectedComponent.additionalDetails.customerInfo}
								<div class="property-group">
									<h3>Customer Information</h3>
									{#if isValidValue(selectedComponent.additionalDetails.customerInfo.customerCount)}
										<div class="property">
											<span class="property-name">Customer Count:</span>
											<span class="property-value">{selectedComponent.additionalDetails.customerInfo.customerCount}</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.customerInfo.customerType && selectedComponent.additionalDetails.customerInfo.customerType !== 'N/A'}
										<div class="property">
											<span class="property-name">Customer Type:</span>
											<span class="property-value">{selectedComponent.additionalDetails.customerInfo.customerType}</span>
										</div>
									{/if}
								</div>
							{/if}
							{#if selectedComponent.additionalDetails.connectivity && selectedComponent.additionalDetails.connectivity.nodes && selectedComponent.additionalDetails.connectivity.nodes.length > 0}
								{@const nodes = selectedComponent.additionalDetails.connectivity.nodes}
								<div class="property-group">
									<h3>Connectivity</h3>
									{#each nodes as node, index}
									{@const hasValidNode =
										isValidValue(node.name) ||
										isValidValue(node.id) ||
										isValidValue(node.busName)
										}

									{#if (hasValidNode) }
										
											<h4>Terminal {index + 1}</h4>
											<div class="property">
												<span class="property-name">Node Name:</span>
												<span class="property-value">{node.name}</span>
											</div>
											<div class="property">
												<span class="property-name">Node ID:</span>
												<span class="property-value">{node.id}</span>
											</div>
											<div class="property">
												<span class="property-name">Bus Name:</span>
												<span class="property-value">{node.busName}</span>
											</div>
										
									{/if}
									{/each}
								</div>
								
							
							{/if}
							{#if selectedComponent.additionalDetails.measurements && selectedComponent.additionalDetails.measurements.length > 0}
								<div class="property-group">
									<h3>Measurements ({selectedComponent.additionalDetails.measurements.length})</h3>
									<div class="scrollable-content">
										{#each Object.entries(groupMeasurementsByType(selectedComponent.additionalDetails.measurements)) as [type, meas]}
											<h5>{formatPropertyName(type)} ({meas.length})</h5>
											{#each meas as m}
												<div class="property">
													<span class="property-name">{m.name}:</span>
													<span class="property-value">{m.unit ? m.unit : "No unit"}</span>
												</div>
											{/each}
										{/each}
									</div>
								</div>
							{/if}
						{:else if 	selectedComponent.type === CIMComponentTypes.LoadBreakSwitch ||
									selectedComponent.type === CIMComponentTypes.Breaker ||
									selectedComponent.type === CIMComponentTypes.Recloser ||
									selectedComponent.type === CIMComponentTypes.Fuse
									 }
							
							{#if selectedComponent.additionalDetails.description}
								<div class="property-group">
									<div class="property">
										<span class="property-name">Description:</span>
										<span class="property-value">{selectedComponent.additionalDetails.description}</span>
									</div>
								</div>
							{/if}

							{#if selectedComponent.additionalDetails.status}
								<div class="property-group">
									<h3>Status</h3>
									{#if selectedComponent.additionalDetails.status.normalOpen !== undefined}
										<div class="property">
											<span class="property-name">Normal State:</span>
											<span class="property-value {selectedComponent.additionalDetails.status.normalOpen ? 'status-off' : 'status-on'}">
												{selectedComponent.additionalDetails.status.normalOpen ? 'Open' : 'Closed'}
											</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.status.inService !== undefined}
										<div class="property">
											<span class="property-name">In Service:</span>
											<span class="property-value {selectedComponent.additionalDetails.status.inService ? 'status-on' : 'status-off'}">
												{selectedComponent.additionalDetails.status.inService ? 'Yes' : 'No'}
											</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.status.normallyInService !== undefined}
										<div class="property">
											<span class="property-name">Normally In Service:</span>
											<span class="property-value {selectedComponent.additionalDetails.status.normallyInService ? 'status-on' : 'status-off'}">
												{selectedComponent.additionalDetails.status.normallyInService ? 'Yes' : 'No'}
											</span>
										</div>
									{/if}
								</div>
							{/if}

							{#if selectedComponent.additionalDetails.electricalProperties}
								<div class="property-group">
									<h3>Electrical Properties</h3>
									{#each Object.entries(selectedComponent.additionalDetails.electricalProperties) as [key, prop]}
										{#if prop && prop.value !== undefined && prop.value !== null}
											<div class="property">
												<span class="property-name">{formatPropertyName(key)}:</span>
												<span class="property-value">
													{formatNumber(prop.value)}
													{prop.unit ? ' ' + prop.unit : ''}
												</span>
											</div>
										{/if}
									{/each}
								</div>
							{/if}

							{#if selectedComponent.additionalDetails.connectivity}
								<div class="property-group">
									<h3>Connectivity</h3>
									{#if selectedComponent.additionalDetails.connectivity.fromNode}
										<div class="property">
											<span class="property-name">From Node:</span>
											<span class="property-value">
												{selectedComponent.additionalDetails.connectivity.fromNode.name || selectedComponent.additionalDetails.connectivity.fromNode.id}
											</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.connectivity.toNode}
										<div class="property">
											<span class="property-name">To Node:</span>
											<span class="property-value">
												{selectedComponent.additionalDetails.connectivity.toNode.name || selectedComponent.additionalDetails.connectivity.toNode.id}
											</span>
										</div>
									{/if}
								</div>
							{/if}

							{#if selectedComponent.additionalDetails.additionalProperties}
								<div class="property-group">
									<h3>Additional Properties</h3>
									{#each Object.entries(selectedComponent.additionalDetails.additionalProperties) as [key, value]}
										{#if value !== undefined && value !== null}
											<div class="property">
												<span class="property-name">{formatPropertyName(key)}:</span>
												<span class="property-value">{value}</span>
											</div>
										{/if}
									{/each}
								</div>
							{/if}

							{#if selectedComponent.additionalDetails.measurements && selectedComponent.additionalDetails.measurements.length > 0}
								<div class="property-group">
									<details>
										<summary>Measurements</summary>
										{#each Object.entries(groupMeasurementsByType(selectedComponent.additionalDetails.measurements)) as [type, measurements]}
											{#if measurements && measurements.length > 0}
												<h5>{formatPropertyName(type)} ({measurements.length})</h5>
												<div class="measurement-list">
													{#each measurements as m}
														<div class="measurement-item">
															<div class="measurement-name">{m.name}</div>
															<div class="measurement-detail">
																{#if m.phases}
																	<span class="badge">Phase: {m.phases}</span>
																{/if}
																{#if m.unit}
																	<span class="badge">Unit: {m.unit}</span>
																{/if}
															</div>
														</div>
													{/each}
												</div>
											{/if}
										{/each}
									</details>
								</div>
							{/if}
						{:else if selectedComponent.type === CIMComponentTypes.RatioTapChanger}
							{#if selectedComponent.additionalDetails.description}
								<div class="property-group">
									<div class="property">
										<span class="property-name">Description:</span>
										<span class="property-value">{selectedComponent.additionalDetails.description}</span>
									</div>
								</div>
							{/if}

							{#if selectedComponent.additionalDetails.transformer}
								<div class="property-group">
									<h4>Associated Transformer</h4>
									<div class="property">
										<span class="property-name">Name:</span>
										<span class="property-value">{selectedComponent.additionalDetails.transformer.name}</span>
									</div>
									<div class="property">
										<span class="property-name">ID:</span>
										<span class="property-value">{selectedComponent.additionalDetails.transformer.id}</span>
									</div>
								</div>
							{/if}

							{#if selectedComponent.additionalDetails.details && Object.keys(selectedComponent.additionalDetails.details).length > 0}
								<div class="property-group">
									<h4>Operational Details</h4>
									{#each Object.entries(selectedComponent.additionalDetails.details) as [key, value]}
										{#if isValidValue(value)}
											<div class="property">
												<span class="property-name">{formatPropertyName(key)}:</span>
												<span class="property-value">{value}</span>
											</div>
										{/if}
									{/each}
								</div>
							{/if}

							{#if selectedComponent.additionalDetails.controlSettings && Object.keys(selectedComponent.additionalDetails.controlSettings).length > 0}
								<div class="property-group">
									<h4>Control Settings</h4>
									{#each Object.entries(selectedComponent.additionalDetails.controlSettings) as [key, value]}
										{#if isValidValue(value)}
											<div class="property">
												<span class="property-name">{formatPropertyName(key)}:</span>
												<span class="property-value">{value}</span>
											</div>
										{/if}
									{/each}
								</div>
							{/if}

							{#if selectedComponent.additionalDetails.measurements && selectedComponent.additionalDetails.measurements.length > 0}
								<div class="property-group">
									<details>
										<summary>Measurements</summary>
										{#each Object.entries(groupMeasurementsByType(selectedComponent.additionalDetails.measurements)) as [type, measurements]}
											{#if measurements && measurements.length > 0}
												<h5>{formatPropertyName(type)} ({measurements.length})</h5>
												<div class="measurement-list">
													{#each measurements as m}
														<div class="measurement-item">
															<div class="measurement-name">{m.name}</div>
															<div class="measurement-detail">
																{#if m.phases}
																	<span class="badge">Phase: {m.phases}</span>
																{/if}
																{#if m.unit}
																	<span class="badge">Unit: {m.unit}</span>
																{/if}
															</div>
														</div>
													{/each}
												</div>
											{/if}
										{/each}
									</details>
								</div>
							{/if}
						{:else if selectedComponent.type === CIMComponentTypes.BatteryUnit}
							<div class="property-group">
								<h4>Status</h4>
								<div class="property">
									<span class="property-name">State:</span>
									<span class="property-value">{selectedComponent.additionalDetails?.state || "Unknown"}</span>
								</div>
								{#if selectedComponent.additionalDetails?.stateOfCharge !== undefined && selectedComponent.additionalDetails?.stateOfCharge !== null}
									<div class="property">
										<span class="property-name">State of Charge:</span>
										<span class="property-value">{selectedComponent.additionalDetails.stateOfCharge}%</span>
									</div>
								{/if}
							</div>

							{#if selectedComponent.additionalDetails?.specifications}
								<div class="property-group">
									<h4>Specifications</h4>
									{#if selectedComponent.additionalDetails.specifications.capacity}
										<div class="property">
											<span class="property-name">Capacity:</span>
											<span class="property-value">
												{selectedComponent.additionalDetails.specifications.capacity}
												{selectedComponent.additionalDetails.specifications.capacityUnit || "kWh"}
											</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.specifications.storedEnergy}
										<div class="property">
											<span class="property-name">Stored Energy:</span>
											<span class="property-value">
												{selectedComponent.additionalDetails.specifications.storedEnergy}
												{selectedComponent.additionalDetails.specifications.capacityUnit || "kWh"}
											</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.specifications.ratedApparentPower}
										<div class="property">
											<span class="property-name">Rated Power:</span>
											<span class="property-value">
												{selectedComponent.additionalDetails.specifications.ratedApparentPower}
												{selectedComponent.additionalDetails.specifications.powerUnit || "kVA"}
											</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.specifications.ratedVoltage}
										<div class="property">
											<span class="property-name">Rated Voltage:</span>
											<span class="property-value">
												{selectedComponent.additionalDetails.specifications.ratedVoltage}
												{selectedComponent.additionalDetails.specifications.voltageUnit || "V"}
											</span>
										</div>
									{/if}
								</div>
							{/if}

							{#if selectedComponent.additionalDetails?.output}
								<div class="property-group">
									<h4>Current Output</h4>
									{#if selectedComponent.additionalDetails.output.activePower !== null}
										<div class="property">
											<span class="property-name">Active Power:</span>
											<span class="property-value">
												{selectedComponent.additionalDetails.output.activePower}
												{selectedComponent.additionalDetails.output.powerUnit || "kW"}
											</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.output.reactivePower !== null}
										<div class="property">
											<span class="property-name">Reactive Power:</span>
											<span class="property-value">
												{selectedComponent.additionalDetails.output.reactivePower}
												{selectedComponent.additionalDetails.output.powerUnit || "kVAr"}
											</span>
										</div>
									{/if}
								</div>
							{/if}
							{#if selectedComponent.additionalDetails.connection}
								<div class="property-group">
									<h3>connection</h3>
									 <div class="property">
										<span class="property-name">Connection ID:</span>
										<span class="property-value">{selectedComponent.additionalDetails.connection.id || "N/A"}</span>
									</div>
									<div class="property">
										<span class="property-name">Connection Name:</span>
										<span class="property-value">{
											selectedComponent.additionalDetails.connection.name || "N/A"
										}</span>
									</div>
								</div>
							{/if}
								{#if selectedComponent.additionalDetails.location}
								<div class="property-group">
									<h3>Location</h3>
									 <div class="property">
										<span class="property-name">Latitude:</span>
										<span class="property-value">{selectedComponent.additionalDetails.location.latitude|| "N/A"}</span>
									</div>
									<div class="property">
										<span class="property-name">Longitude:</span>
										<span class="property-value">{
											selectedComponent.additionalDetails.location.longitude || "N/A"
										}</span>
									</div>
								</div>
							{/if}
				
						{:else if selectedComponent.type === CIMComponentTypes.PhotovoltaicUnit}
							<div class="property-group">
								<h4>Status</h4>
								<div class="property">
									<span class="property-name">State:</span>
									<span class="property-value">{selectedComponent.additionalDetails?.state || "Unknown"}</span>
								</div>
							</div>

							{#if selectedComponent.additionalDetails?.specifications}
								<div class="property-group">
									<h4>Specifications</h4>
									{#if selectedComponent.additionalDetails.specifications.capacity}
										<div class="property">
											<span class="property-name">Capacity:</span>
											<span class="property-value">
												{selectedComponent.additionalDetails.specifications.capacity}
												{selectedComponent.additionalDetails.specifications.capacityUnit || "kWh"}
											</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.specifications.minPower}
										<div class="property">
											<span class="property-name">Minimum Power:</span>
											<span class="property-value">
												{selectedComponent.additionalDetails.specifications.minPower}
												{selectedComponent.additionalDetails.specifications.powerUnit || "kWh"}
											</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.specifications.ratedApparentPower}
										<div class="property">
											<span class="property-name">Rated Power:</span>
											<span class="property-value">
												{selectedComponent.additionalDetails.specifications.ratedApparentPower}
												{selectedComponent.additionalDetails.specifications.powerUnit || "kVA"}
											</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.specifications.ratedVoltage}
										<div class="property">
											<span class="property-name">Rated Voltage:</span>
											<span class="property-value">
												{selectedComponent.additionalDetails.specifications.ratedVoltage}
												{selectedComponent.additionalDetails.specifications.voltageUnit || "V"}
											</span>
										</div>
									{/if}
								</div>
							{/if}

							{#if selectedComponent.additionalDetails?.output}
								<div class="property-group">
									<h4>Current Output</h4>
									{#if selectedComponent.additionalDetails.output.activePower !== null}
										<div class="property">
											<span class="property-name">Active Power:</span>
											<span class="property-value">
												{selectedComponent.additionalDetails.output.activePower}
												{selectedComponent.additionalDetails.output.powerUnit || "kW"}
											</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.output.reactivePower !== null}
										<div class="property">
											<span class="property-name">Reactive Power:</span>
											<span class="property-value">
												{selectedComponent.additionalDetails.output.reactivePower}
												{selectedComponent.additionalDetails.output.powerUnit || "kVAr"}
											</span>
										</div>
									{/if}
								</div>
							{/if}
							{#if selectedComponent.additionalDetails.connection}
								<div class="property-group">
									<h3>connection</h3>
									 <div class="property">
										<span class="property-name">Connection ID:</span>
										<span class="property-value">{selectedComponent.additionalDetails.connection.id || "N/A"}</span>
									</div>
									<div class="property">
										<span class="property-name">Connection Name:</span>
										<span class="property-value">{
											selectedComponent.additionalDetails.connection.name || "N/A"
										}</span>
									</div>
								</div>
							{/if}
							{#if selectedComponent.additionalDetails.location}
								<div class="property-group">
									<h3>Location</h3>
									 <div class="property">
										<span class="property-name">Latitude:</span>
										<span class="property-value">{selectedComponent.additionalDetails.location.latitude|| "N/A"}</span>
									</div>
									<div class="property">
										<span class="property-name">Longitude:</span>
										<span class="property-value">{
											selectedComponent.additionalDetails.location.longitude || "N/A"
										}</span>
									</div>
								</div>
							{/if}
						
						{:else if selectedComponent.type === CIMComponentTypes.SynchronousMachine}
							<div class="property-group">
								<div class="property">
									<span class="property-name">Function:</span>
									<span class="property-value">{selectedComponent.additionalDetails?.generatorType || "Unknown"}</span>
								</div>
							</div>

							<div class="property-group">
								<h4>Operating Status</h4>
								<div class="property">
									<span class="property-name">Mode:</span>
									<span class="property-value">{selectedComponent.additionalDetails?.operatingMode || "Unknown"}</span>
								</div>
							</div>

							{#if selectedComponent.additionalDetails?.specifications}
								<div class="property-group">
									<h4>Specifications</h4>
									{#if selectedComponent.additionalDetails.specifications.ratedApparentPower != null}
										<div class="property">
											<span class="property-name">Rated Power:</span>
											<span class="property-value">
												{selectedComponent.additionalDetails.specifications.ratedApparentPower}
												{selectedComponent.additionalDetails.specifications.powerUnit || "MVA"}
											</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.specifications.ratedVoltage != null}
										<div class="property">
											<span class="property-name">Rated Voltage:</span>
											<span class="property-value">
												{selectedComponent.additionalDetails.specifications.ratedVoltage}
												{selectedComponent.additionalDetails.specifications.voltageUnit || "kV"}
											</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.specifications.nominalPower != null}
										<div class="property">
											<span class="property-name">Nominal Power:</span>
											<span class="property-value">
												{selectedComponent.additionalDetails.specifications.nominalPower}
												{selectedComponent.additionalDetails.specifications.powerUnit || "MVA"}
											</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.specifications.baseApparentPower != null}
										<div class="property">
											<span class="property-name">Base Power:</span>
											<span class="property-value">
												{selectedComponent.additionalDetails.specifications.baseApparentPower}
												{selectedComponent.additionalDetails.specifications.powerUnit || "MVA"}
											</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.specifications.maxGenerationPower != null}
										<div class="property">
											<span class="property-name">Max Generation:</span>
											<span class="property-value">
												{selectedComponent.additionalDetails.specifications.maxGenerationPower}
												{selectedComponent.additionalDetails.specifications.powerUnit || "MVA"}
											</span>
										</div>
									{/if}
								</div>
							{/if}

							{#if selectedComponent.additionalDetails?.output}
								<div class="property-group">
									<h4>Current Output</h4>
									{#if selectedComponent.additionalDetails.output.activePower != null}
										<div class="property">
											<span class="property-name">Active Power (p):</span>
											<span class="property-value">
												{selectedComponent.additionalDetails.output.activePower}
												{selectedComponent.additionalDetails.output.powerUnit || "MW"}
											</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.output.reactivePower != null}
										<div class="property">
											<span class="property-name">Reactive Power (q):</span>
											<span class="property-value">
												{selectedComponent.additionalDetails.output.reactivePower}
												{selectedComponent.additionalDetails.output.powerUnit || "MVAr"}
											</span>
										</div>
									{/if}
								</div>
							{/if}

							{#if selectedComponent.additionalDetails?.hasRegulationControl}
								<div class="property-group">
									<h4>Regulation Control</h4>
									<div class="property">
										<span class="property-name">Control ID:</span>
										<span class="property-value">{selectedComponent.additionalDetails.regulationControlId || "N/A"}</span>
									</div>
								</div>
							{/if}

							{#if selectedComponent.additionalDetails?.hasDynamicsModel}
								<div class="property-group">
									<h4>Dynamics Model</h4>
									<div class="property">
										<span class="property-name">Model ID:</span>
										<span class="property-value">{selectedComponent.additionalDetails.dynamicsModelId || "N/A"}</span>
									</div>
								</div>
							{/if}

							{#if selectedComponent.location}
								<div class="property-group">
									<h4>Location</h4>
									<div class="property">
										<span class="property-name">Latitude:</span>
										<span class="property-value">{selectedComponent.location.latitude.toFixed(6)}</span>
									</div>
									<div class="property">
										<span class="property-name">Longitude:</span>
										<span class="property-value">{selectedComponent.location.longitude.toFixed(6)}</span>
									</div>
								</div>
							{/if}
						{:else if selectedComponent.type === CIMComponentTypes.EnergySource}
							 {#if selectedComponent.additionalDetails?.voltage}
								<div class="property-group">
									<h4>Voltage</h4>
									{#if selectedComponent.additionalDetails.voltage.baseVoltage != null}
										<div class="property">
											<span class="property-name">Base Voltage:</span>
											<span class="property-value">{selectedComponent.additionalDetails.voltage.baseVoltage} kV</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.voltage.nominalVoltage != null}
										<div class="property">
											<span class="property-name">Nominal Voltage:</span>
											<span class="property-value">{selectedComponent.additionalDetails.voltage.nominalVoltage} kV</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.voltage.magnitude != null}
										<div class="property">
											<span class="property-name">Voltage Magnitude:</span>
											<span class="property-value">{selectedComponent.additionalDetails.voltage.magnitude} V</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.voltage.angle != null}
										<div class="property">
											<span class="property-name">Voltage Angle:</span>
											<span class="property-value">{selectedComponent.additionalDetails.voltage.angle}°</span>
										</div>
									{/if}
								</div>
							 {/if}

							{#if selectedComponent.additionalDetails?.impedance}
								<div class="property-group">
									<h4>Impedance</h4>
									{#if selectedComponent.additionalDetails.impedance.r1 != null}
										<div class="property">
											<span class="property-name">Positive Sequence Resistance (R1):</span>
											<span class="property-value">{selectedComponent.additionalDetails.impedance.r1} Ω</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.impedance.x1 != null}
										<div class="property">
											<span class="property-name">Positive Sequence Reactance (X1):</span>
											<span class="property-value">{selectedComponent.additionalDetails.impedance.x1} Ω</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.impedance.r0 != null}
										<div class="property">
											<span class="property-name">Zero Sequence Resistance (R0):</span>
											<span class="property-value">{selectedComponent.additionalDetails.impedance.r0} Ω</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.impedance.x0 != null}
										<div class="property">
											<span class="property-name">Zero Sequence Reactance (X0):</span>
											<span class="property-value">{selectedComponent.additionalDetails.impedance.x0} Ω</span>
										</div>
									{/if}
								</div>
							{/if}

							{#if selectedComponent.additionalDetails?.power && (selectedComponent.additionalDetails.power.activePower != null || selectedComponent.additionalDetails.power.reactivePower )}
								<div class="property-group">
									<h4>Power Output</h4>
									{#if selectedComponent.additionalDetails.power.activePower != null}
										<div class="property">
											<span class="property-name">Active Power:</span>
											<span class="property-value">{selectedComponent.additionalDetails.power.activePower} MW</span>
										</div>
									{/if}
									{#if selectedComponent.additionalDetails.power.reactivePower != null}
										<div class="property">
											<span class="property-name">Reactive Power:</span>
											<span class="property-value">{selectedComponent.additionalDetails.power.reactivePower} MVAr</span>
										</div>
									{/if}
								</div>
							{/if}

							<div class="property-group">
								<h4>Connection</h4>
								{#if selectedComponent.additionalDetails?.bus}
									<div class="property">
										<span class="property-name">Bus:</span>
										<span class="property-value">{selectedComponent.additionalDetails.bus}</span>
									</div>
								{/if}
								{#if selectedComponent.additionalDetails?.terminalId}
									<div class="property">
										<span class="property-name">Terminal ID:</span>
										<span class="property-value">{selectedComponent.additionalDetails.terminalId}</span>
									</div>
								{/if}
							</div>

							{#if selectedComponent.additionalDetails?.location}
								<div class="property-group">
									<h4>Location</h4>
									<div class="property">
										<span class="property-name">Latitude:</span>
										<span class="property-value">{selectedComponent.additionalDetails.location.latitude?.toFixed(6) || "N/A"}</span>
									</div>
									<div class="property">
										<span class="property-name">Longitude:</span>
										<span class="property-value">{selectedComponent.additionalDetails.location.longitude?.toFixed(6) || "N/A"}</span>
									</div>
								</div>
							{/if}
						
						{:else if selectedComponent.type === CIMComponentTypes.LinearShuntCompensator}

							<div class="property-group">
								<h4>Voltage Information</h4>
								{#if selectedComponent.additionalDetails?.baseVoltage}
									<div class="property">
										<span class="property-name">Base Voltage:</span>
										<span class="property-value">{selectedComponent.additionalDetails.baseVoltage} V</span>
									</div>
								{/if}
								{#if selectedComponent.additionalDetails?.nominalU}
									<div class="property">
										<span class="property-name">Nominal Voltage:</span>
										<span class="property-value">{selectedComponent.additionalDetails.nominalU} V</span>
									</div>
								{/if}
							</div>

							<div class="property-group">
								<h4>Compensator Properties</h4>
								{#if selectedComponent.additionalDetails?.bPerSection != null}
									<div class="property">
										<span class="property-name">Susceptance per Section:</span>
										<span class="property-value">{selectedComponent.additionalDetails.bPerSection} S</span>
									</div>
								{/if}
								{#if selectedComponent.additionalDetails?.gPerSection != null}
									<div class="property">
										<span class="property-name">Conductance per Section:</span>
										<span class="property-value">{selectedComponent.additionalDetails.gPerSection} S</span>
									</div>
								{/if}
								{#if selectedComponent.additionalDetails?.maximumSections != null}
									<div class="property">
										<span class="property-name">Maximum Sections:</span>
										<span class="property-value">{selectedComponent.additionalDetails.maximumSections}</span>
									</div>
								{/if}
								{#if selectedComponent.additionalDetails?.normalSections != null}
									<div class="property">
										<span class="property-name">Normal Sections:</span>
										<span class="property-value">{selectedComponent.additionalDetails.normalSections}</span>
									</div>
								{/if}
							</div>

							<div class="property-group">
								<h4>Connection Details</h4>
								<div class="property">
									<span class="property-name">Grounded:</span>
									<span class="property-value">{selectedComponent.additionalDetails?.grounded ? "Yes" : "No"}</span>
								</div>
								{#if selectedComponent.additionalDetails?.phaseConnection}
									<div class="property">
										<span class="property-name">Phase Connection:</span>
										<span class="property-value">{selectedComponent.additionalDetails.phaseConnection}</span>
									</div>
								{/if}
								{#if selectedComponent.additionalDetails?.aVRDelay != null}
									<div class="property">
										<span class="property-name">AVR Delay:</span>
										<span class="property-value">{selectedComponent.additionalDetails.aVRDelay} s</span>
									</div>
								{/if}
							</div>

							{#if selectedComponent.additionalDetails?.location}
								<div class="property-group">
									<h4>Location</h4>
									<div class="property">
										<span class="property-name">Latitude:</span>
										<span class="property-value">{selectedComponent.additionalDetails.location.latitude?.toFixed(6) || "N/A"}</span>
									</div>
									<div class="property">
										<span class="property-name">Longitude:</span>
										<span class="property-value">{selectedComponent.additionalDetails.location.longitude?.toFixed(6) || "N/A"}</span>
									</div>
								</div>
							{/if}
						{:else if selectedComponent.type === CIMComponentTypes.TransformerTank}
							<div class="property-group">
								<div class="property">
									<span class="property-name">Tank Name:</span>
									<span class="property-value">{selectedComponent.additionalDetails?.name || "Unknown"}</span>
								</div>
								<div class="property">
									<span class="property-name">Tank ID:</span>
									<span class="property-value">{selectedComponent.additionalDetails?.id || "N/A"}</span>
								</div>
							</div>

							<div class="property-group">
								<h4>Tank Details</h4>
								{#if selectedComponent.additionalDetails?.description}
									<div class="property">
										<span class="property-name">Description:</span>
										<span class="property-value">{selectedComponent.additionalDetails.description}</span>
									</div>
								{/if}
								{#if selectedComponent.additionalDetails?.windingInsulationType}
									<div class="property">
										<span class="property-name">Winding Insulation:</span>
										<span class="property-value">{selectedComponent.additionalDetails.windingInsulationType}</span>
									</div>
								{/if}
								{#if selectedComponent.additionalDetails?.windingRiseTemperature}
									<div class="property">
										<span class="property-name">Winding Rise Temp:</span>
										<span class="property-value">{selectedComponent.additionalDetails.windingRiseTemperature}</span>
									</div>
								{/if}
							</div>

							<div class="property-group">
								<h4>Power Ratings</h4>
								{#if selectedComponent.additionalDetails?.ratings}
									{#each Object.entries(selectedComponent.additionalDetails.ratings) as [key, value]}
										<div class="property">
											<span class="property-name">{formatPropertyName(key)}:</span>
											<span class="property-value">{value}</span>
										</div>
									{/each}
								{/if}
							</div>

							<div class="property-group">
								<h4>Impedance & Reactance</h4>
								{#if selectedComponent.additionalDetails?.impedance}
									<div class="property">
										<span class="property-name">Resistance (R):</span>
										<span class="property-value">{selectedComponent.additionalDetails.impedance.r} Ω</span>
									</div>
								{/if}
								{#if selectedComponent.additionalDetails?.reactance}
									<div class="property">
										<span class="property-name">Reactance (X):</span>
										<span class="property-value">{selectedComponent.additionalDetails.reactance.x} Ω</span>
									</div>
								{/if}
							</div>

							<div class="property-group">
								<h4>Admittance</h4>
								{#if selectedComponent.additionalDetails?.admittance}
									<div class="property">
										<span class="property-name">Susceptance (B):</span>
										<span class="property-value">{selectedComponent.additionalDetails.admittance.b} S</span>
									</div>
								{/if}
								{#if selectedComponent.additionalDetails?.conductance}
									<div class="property">
										<span class="property-name">Conductance (G):</span>
										<span class="property-value">{selectedComponent.additionalDetails.conductance.g} S</span>
									</div>
								{/if}
							</div>

							<div class="property-group">
								<h4>Connection Configuration</h4>
								{#if selectedComponent.additionalDetails?.connections}
									{#each Object.entries(selectedComponent.additionalDetails.connections) as [key, value]}
										<div class="property">
											<span class="property-name">{formatPropertyName(key)}:</span>
											<span class="property-value">{value}</span>
										</div>
									{/each}
								{/if}
							</div>

							<div class="property-group">
								<h4>Other Electrical Parameters</h4>
								{#if selectedComponent.additionalDetails?.other}
									{#each Object.entries(selectedComponent.additionalDetails.other) as [key, value]}
										<div class="property">
											<span class="property-name">{formatPropertyName(key)}:</span>
											<span class="property-value">{value}</span>
										</div>
									{/each}
								{/if}
							</div>

							<div class="property-group">
								<h4>Connected Equipment</h4>
								{#if selectedComponent.additionalDetails?.connectedEquipment}
									<ul class="connected-equipment">
										{#each selectedComponent.additionalDetails.connectedEquipment as equipment}
											<li>{equipment.name} ({equipment.type})</li>
										{/each}
									</ul>
								{/if}
							</div>

							<div class="property-group">
								<h4>Measurements</h4>
								{#if selectedComponent.additionalDetails?.measurements}
									<ul class="measurements">
										{#each Object.entries(selectedComponent.additionalDetails.measurements) as [type, measurement]}
											<li class="measurement-type">
												{formatPropertyName(type.split("#").pop())}:
												<ul>
													{#each measurement as m}
														<li>
															{m.name}
															{#if m.unit && m.unit !== "unknown"}
																({m.unit})
															{/if}
															{#if m.phases}
																[Phase: {m.phases}]
															{/if}
														</li>
													{/each}
												</ul>
											</li>
										{/each}
									</ul>
								{/if}
							</div>
						
						{:else if selectedComponent.type === CIMComponentTypes.ConnectivityNode}
							<div class="property-group">
								<div class="property">
									<span class="property-name">Node Name:</span>
									<span class="property-value">{selectedComponent.additionalDetails?.name || "Unknown"}</span>
								</div>
								<div class="property">
									<span class="property-name">Node ID:</span>
									<span class="property-value">{selectedComponent.additionalDetails?.id || "N/A"}</span>
								</div>
							</div>

							<div class="property-group">
								<h4>Bus Information</h4>
								{#if selectedComponent.additionalDetails?.busName}
									<div class="property">
										<span class="property-name">Bus Name:</span>
										<span class="property-value">{selectedComponent.additionalDetails.busName}</span>
									</div>
								{/if}
								{#if selectedComponent.additionalDetails?.busType}
									<div class="property">
										<span class="property-name">Bus Type:</span>
										<span class="property-value">{selectedComponent.additionalDetails.busType}</span>
									</div>
								{/if}
							</div>

							<div class="property-group">
								<h4>Connectivity</h4>
								{#if selectedComponent.additionalDetails?.connectivity}
									<div class="property">
										<span class="property-name">Connectivity:</span>
										<span class="property-value">{selectedComponent.additionalDetails.connectivity}</span>
									</div>
								{/if}
							</div>
						
						
						
							
							
						{/if}
					{/if}
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.canvas-container {
		position: relative;
		width: 100%;
		height: 100%;
	}

	canvas {
		width: 100%;
		height: 100%;
		display: block;
	}

	.popup {
		position: absolute;
		background: var(--popup-bg);
		border: 1px solid var(--popup-border);
		padding: 0;
		box-shadow: 2px 2px 10px rgba(0, 0, 0, 0.2);
		font-size: 14px;
		z-index: 1000;
		transform: translate(-50%, -50%);
		width: 300px;
		max-height: 400px;
		pointer-events: auto;
		display: flex;
		flex-direction: column;
	}

	.popup h3 {
		margin: 0;
		padding: 10px;
		background: var(--popup-header-bg);
		border-bottom: 1px solid var(--popup-border);
		font-size: 16px;
		color: var(--popup-text);
	}

	.popup-content {
		flex: 1;
		overflow-y: auto;
		padding: 10px;
		background: var(--popup-bg);
		color: var(--popup-text);
	}

	.popup-footer {
		padding: 10px;
		background: var(--popup-header-bg);
		border-top: 1px solid var(--popup-border);
	}

	.popup button {
		display: block;
		width: 100%;
		padding: 8px;
		background: var(--popup-button-bg);
		border: 1px solid var(--popup-border);
		border-radius: 4px;
		cursor: pointer;
		color: var(--popup-text);
	}

	.popup button:hover {
		background: var(--popup-button-hover);
	}

	.node-item {
		padding: 8px;
		margin: 5px 0;
		border: 1px solid var(--popup-border);
		border-radius: 4px;
		cursor: pointer;
		background: var(--popup-item-bg);
		color: var(--popup-text);
	}

	.node-item:hover {
		background-color: var(--popup-item-hover);
	}

	.detail-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background-color: rgba(0, 0, 0, 0.5);
		display: flex;
		justify-content: center;
		align-items: center;
		z-index: 1000;
	}

	.detail-panel {
		background: var(--detail-bg);
		border-radius: 8px;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
		padding: 30px;
		width: 90%;
		max-width: 800px;
		max-height: 90vh;
		overflow-y: auto;
		position: relative;
		margin: auto;
		color: var(--detail-text);
	}

	.close-btn {
		position: absolute;
		top: 15px;
		right: 15px;
		background: none;
		border: none;
		font-size: 24px;
		cursor: pointer;
		padding: 5px;
		width: 40px;
		height: 40px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		transition: background-color 0.2s;
		z-index: 1001;
		color: var(--detail-text);
	}

	.close-btn:hover {
		background-color: var(--detail-close-hover);
	}

	.property-group {
		margin: 20px 0;
		padding: 15px;
		background: var(--detail-group-bg);
		border-radius: 8px;
	}

	.property-group h4 {
		margin: 0 0 15px 0;
		color: var(--detail-text);
		font-size: 18px;
		font-weight: 600;
	}

	.property {
		display: flex;
		justify-content: space-between;
		margin: 8px 0;
		padding: 8px 12px;
		border-radius: 6px;
		transition: background-color 0.2s;
	}

	.property:hover {
		background-color: var(--detail-property-hover);
	}

	.property-name {
		font-weight: 600;
		color: var(--detail-label);
		font-size: 15px;
	}

	.property-value {
		color: var(--detail-text);
		font-size: 15px;
	}

	.loading {
		padding: 30px;
		text-align: center;
		color: var(--detail-text);
		background-color: var(--detail-loading-bg);
		border-radius: 8px;
		font-size: 16px;
	}

	.error-message {
		color: var(--detail-error);
		padding: 20px;
		margin: 15px 0;
		background-color: var(--detail-error-bg);
		border-radius: 8px;
		font-size: 16px;
	}

	h3 {
		margin: 0 0 20px 0;
		color: var(--detail-text);
		font-size: 24px;
		font-weight: 600;
	}

	.detail-panel h3 {
		margin-top: 0;
		border-bottom: 1px solid var(--detail-border);
		padding-bottom: 8px;
	}

	.detail-panel .property-group {
		margin-bottom: 15px;
	}

	.detail-panel .property-group h4 {
		margin: 10px 0 5px 0;
		font-size: 14px;
		color: var(--detail-label);
		font-weight: bold;
		border-bottom: 1px dotted var(--detail-border);
		padding-bottom: 3px;
	}

	.detail-panel .property {
		display: flex;
		justify-content: space-between;
		padding: 4px 0;
		font-size: 13px;
	}

	.detail-panel .property-name {
		font-weight: bold;
		color: var(--detail-label);
		max-width: 50%;
		font-size: 12px;
	}

	.detail-panel .property-value {
		color: var(--detail-text);
		text-align: right;
		max-width: 50%;
	}

	.detail-panel .connected-equipment {
		margin-top: 10px;
		padding-left: 20px;
	}

	.detail-panel .connected-equipment li {
		margin-bottom: 4px;
		color: var(--detail-text);
	}

	.detail-panel .measurements {
		margin-top: 10px;
		padding-left: 20px;
	}

	.detail-panel .measurements li {
		margin-bottom: 4px;
		color: var(--detail-text);
	}

	.detail-panel .measurements li.measurement-type {
		font-weight: bold;
		margin-bottom: 8px;
	}

	.detail-panel .measurements li.measurement-type ul {
		font-weight: normal;
		margin-top: 4px;
		padding-left: 15px;
	}

	.detail-panel .measurements li.measurement-type ul li {
		margin-bottom: 2px;
	}

	.tank-separator {
		border-top: 1px dashed var(--detail-border);
		margin: 8px 0;
	}

	.matrix-container {
		margin-top: 10px;
		margin-bottom: 15px;
	}

	.matrix-table {
		border-collapse: collapse;
		margin-top: 5px;
		font-size: 0.9em;
	}

	.matrix-table td {
		border: 1px solid var(--detail-border);
		padding: 4px 8px;
		text-align: right;
		min-width: 60px;
		color: var(--detail-text);
	}

	.matrix-table tr:nth-child(even) {
		background-color: var(--detail-row-alt);
	}

	.scrollable-content {
		max-height: 200px;
		overflow-y: auto;
		padding-right: 10px;
	}

	/* Calculation section styling */
	.calculation-group {
		background-color: var(--detail-calc-bg);
		border-left: 3px solid var(--detail-calc-border);
		padding-left: 10px;
	}

	.property.note {
		margin-bottom: 10px;
		color: var(--detail-note);
		font-size: 0.9em;
	}

	/* Add an info icon before the calculation title */
	.calculation-header::before {
		content: '📊';
		margin-right: 8px;
	}

	details summary {
		cursor: pointer;
		color: var(--detail-text);
		margin: 10px 0;
		font-weight: bold;
	}

	details summary:hover {
		text-decoration: underline;
	}

	h5 {
		margin: 10px 0 5px 0;
		font-size: 14px;
		color: var(--detail-label);
		font-weight: 600;
	}

	h6 {
		margin: 8px 0 4px 0;
		font-size: 13px;
		color: var(--detail-label);
		font-weight: 600;
	}

	:global(:root) {
		--popup-bg: #ffffff;
		--popup-header-bg: #f5f5f5;
		--popup-border: #ccc;
		--popup-text: #333;
		--popup-button-bg: #f0f0f0;
		--popup-button-hover: #e0e0e0;
		--popup-item-bg: #ffffff;
		--popup-item-hover: #f5f5f5;

		--detail-bg: #ffffff;
		--detail-text: #333;
		--detail-label: #666;
		--detail-border: #ddd;
		--detail-group-bg: rgba(0, 0, 0, 0.02);
		--detail-property-hover: rgba(0, 0, 0, 0.02);
		--detail-close-hover: rgba(0, 0, 0, 0.1);
		--detail-loading-bg: rgba(0, 0, 0, 0.05);
		--detail-error: #d32f2f;
		--detail-error-bg: rgba(211, 47, 47, 0.1);
		--detail-row-alt: rgba(0, 0, 0, 0.03);
		--detail-calc-bg: rgba(230, 245, 255, 0.3);
		--detail-calc-border: #4a90e2;
		--detail-note: #555;
	}

	:global(.dark) {
		--popup-bg: #1f2937;
		--popup-header-bg: #111827;
		--popup-border: #374151;
		--popup-text: #f3f4f6;
		--popup-button-bg: #374151;
		--popup-button-hover: #4b5563;
		--popup-item-bg: #1f2937;
		--popup-item-hover: #374151;

		--detail-bg: #1f2937;
		--detail-text: #f3f4f6;
		--detail-label: #9ca3af;
		--detail-border: #374151;
		--detail-group-bg: rgba(255, 255, 255, 0.05);
		--detail-property-hover: rgba(255, 255, 255, 0.05);
		--detail-close-hover: rgba(255, 255, 255, 0.1);
		--detail-loading-bg: rgba(255, 255, 255, 0.05);
		--detail-error: #ef4444;
		--detail-error-bg: rgba(239, 68, 68, 0.1);
		--detail-row-alt: rgba(255, 255, 255, 0.03);
		--detail-calc-bg: rgba(59, 130, 246, 0.1);
		--detail-calc-border: #60a5fa;
		--detail-note: #9ca3af;
	}

	.zoom-controls {
		position: absolute;
		bottom: 4px;
		left: 10px;
		background: var(--control-bg);
		padding: 4px;
		border-radius: 4px;
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
		display: flex;
		align-items: center;
		gap: 6px;
		z-index: 1000;
	}

	.zoom-button {
		width: 24px;
		height: 24px;
		border: 1px solid var(--border-color);
		border-radius: 3px;
		background: var(--control-bg);
		color: var(--text-color);
		font-size: 14px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background-color 0.2s;
	}

	.zoom-button:hover {
		background-color: var(--control-hover);
	}

	.zoom-percentage {
		min-width: 45px;
		text-align: center;
		font-size: 12px;
		color: var(--text-color);
	}

	.reset-button {
		padding: 3px 8px;
		border: 1px solid var(--border-color);
		border-radius: 3px;
		background: var(--control-bg);
		color: var(--text-color);
		font-size: 11px;
		cursor: pointer;
		transition: background-color 0.2s;
	}

	.reset-button:hover {
		background-color: var(--control-hover);
	}

	.legend {
		position: absolute;
		top: 40px;
		right: 10px;
		background: var(--control-bg);
		padding: 15px;
		border-radius: 8px;
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
		z-index: 1000;
		max-width: 250px;
	}

	.legend h4 {
		margin: 0 0 10px 0;
		font-size: 14px;
		color: var(--text-color);
	}

	.legend-items {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var(--text-color);
	}

	.legend-symbol {
		width: 12px;
		height: 12px;
		border-radius: 50%;
	}

	.filter-controls {
		position: absolute;
		top: 40px;
		left: 10px;
		background: var(--control-bg);
		padding: 15px;
		border-radius: 8px;
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
		z-index: 1000;
		max-width: 300px;
	}

	.filter-controls h4 {
		margin: 0 0 10px 0;
		font-size: 14px;
		color: var(--text-color);
	}

	.filter-buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 10px;
	}

	.filter-button {
		padding: 4px 8px;
		border: 1px solid var(--border-color);
		border-radius: 4px;
		background: var(--control-bg);
		color: var(--text-color);
		font-size: 12px;
		cursor: pointer;
		transition: all 0.2s;
	}

	.filter-button:hover {
		background-color: var(--control-hover);
	}

	.filter-button.active {
		background-color: var(--primary-color);
		color: white;
		border-color: var(--primary-color);
	}

	.clear-filters {
		width: 100%;
		padding: 6px;
		background: var(--control-bg);
		border: 1px solid var(--border-color);
		border-radius: 4px;
		color: var(--text-color);
		font-size: 12px;
		cursor: pointer;
		transition: background-color 0.2s;
	}

	.clear-filters:hover {
		background-color: var(--control-hover);
	}

	.toggle-button {
		position: absolute;
		padding: 4px 8px;
		background: var(--control-bg);
		border: 1px solid var(--border-color);
		border-radius: 4px;
		color: var(--text-color);
		cursor: pointer;
		font-size: 11px;
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
		z-index: 1000;
		transition: background-color 0.2s;
		min-width: 80px;
		text-align: center;
	}

	.toggle-button:hover {
		background-color: var(--control-hover);
	}

	.toggle-button.active {
		background-color: var(--primary-color);
		color: white;
		border-color: var(--primary-color);
	}

	:global(:root) {
		--control-bg: #ffffff;
		--control-hover: #f0f0f0;
		--text-color: #374151;
		--border-color: #d1d5db;
		--primary-color: #3b82f6;
	}

	:global(.dark) {
		--control-bg: #1f2937;
		--control-hover: #374151;
		--text-color: #f3f4f6;
		--border-color: #4b5563;
		--primary-color: #60a5fa;
	}

	.filters-toggle {
		top: 10px;
		left: 10px;
	}

	.legend-toggle {
		top: 10px;
		right: 10px;
		z-index: 1;
	}

	.toggle-button.filters-toggle.active {
		background-color: #4a90e2;
		color: white;
		border-color: #4a90e2;
	}

	.toggle-button.legend-toggle.active {
		background-color: #4a90e2;
		color: white;
		border-color: #4a90e2;
	}

	.loading-overlay {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(255, 255, 255, 0.5);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.loading-spinner {
		width: 40px;
		height: 40px;
		border: 4px solid #f3f3f3;
		border-top: 4px solid #3498db;
		border-radius: 50%;
		animation: spin 1s linear infinite;
		margin-bottom: 10px;
	}

	.loading-text {
		color: #333;
		font-size: 14px;
		font-weight: 500;
	}

	@keyframes spin {
		0% { transform: rotate(0deg); }
		100% { transform: rotate(360deg); }
	}
</style>

