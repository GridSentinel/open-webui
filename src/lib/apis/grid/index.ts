import { GRIDAPPSD_API_BASE_URL } from '$lib/constants';
import { CIMComponentTypes, type CIMComponentType } from '$lib/types/cim';


export const getRegions = async () => {
    let error = null;

    const res = await fetch(`${GRIDAPPSD_API_BASE_URL}/regions`, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
        }
    })
        .then(async (res) => {
            console.log("get regios gggggggggg ", res)
            if (!res.ok) throw await res.json();
            return res.json();
        })
        .then((json) => {
            console.log("get regios ############## ", json)
            return json.data;
        })
        .catch((err) => {
            error = err;
            console.log(err);
            return null;
        });

    if (error) {
        throw error;
    }

    return res;
}
export const getSubRegions = async (regionId: string) => {
    let error = null;

    const res = await fetch(`${GRIDAPPSD_API_BASE_URL}/regions/${regionId}/subregions`, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
        }
    })
        .then(async (res) => {
            console.log("get regios gggggggggg ", res)
            if (!res.ok) throw await res.json();
            return res.json();
        })
        .then((json) => {
            console.log("get regios ############## ", json)
            return json.data;
        })
        .catch((err) => {
            error = err;
            console.log(err);
            return null;
        });

    if (error) {
        throw error;
    }

    return res;
}
export const getFeeders = async (subRegionId: string) => {
    let error = null;

    const res = await fetch(`${GRIDAPPSD_API_BASE_URL}/subregions/${subRegionId}/feeders`, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
        }
    })
        .then(async (res) => {
            console.log("get regios gggggggggg ", res)
            if (!res.ok) throw await res.json();
            return res.json();
        })
        .then((json) => {
            console.log("get regios ############## ", json)
            return json.data;
        })
        .catch((err) => {
            error = err;
            console.log(err);
            return null;
        });

    if (error) {
        throw error;
    }

    return res;

}

export const renderGridCombined = async (feederId: string) => {
    let error = null;

    const res = await fetch(`${GRIDAPPSD_API_BASE_URL}/grid/feeders/${feederId}/render`, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
        }
    })
        .then(async (res) => {
            console.log("get regios gggggggggg ", res)
            if (!res.ok) throw await res.json();
            return res.json();
        })
        .then((json) => {
            console.log("get regios ############## ", json)
            return json.data;
        })
        .catch((err) => {
            error = err;
            console.log(err);
            return null;
        });

    if (error) {
        throw error;
    }

    return res;

}
export const getTransformerDetails = async (transformerId: string) => {
    let error = null;

    const res = await fetch(`${GRIDAPPSD_API_BASE_URL}/grid/transformers/${transformerId}`, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
        }
    })
        .then(async (res) => {
            console.log("get transformers  ", res)
            if (!res.ok) throw await res.json();
            return res.json();
        })
        .then((json) => {
            console.log("get transformers ############## ", json)
            return json.data;
        })
        .catch((err) => {
            error = err;
            console.log(err);
            return null;
        });

    if (error) {
        throw error;
    }

    return res;

}
export const getRegulatorDetails = async (regulatorId: string) => {
    let error = null;

    const res = await fetch(`${GRIDAPPSD_API_BASE_URL}/grid/regulators/${regulatorId}`, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
        }
    })
        .then(async (res) => {
            console.log("get regulators  ", res)
            if (!res.ok) throw await res.json();
            return res.json();
        })
        .then((json) => {
            console.log("get regulators ############## ", json)
            return json.data;
        })
        .catch((err) => {
            error = err;
            console.log(err);
            return null;
        });

    if (error) {
        throw error;
    }

    return res;

}
export const getLineDetails = async (lineId: string) => {
    let error = null;
    const res = await fetch(`${GRIDAPPSD_API_BASE_URL}/grid/lines/${lineId}`, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
        }
    })
        .then(async (res) => {
            console.log("get lines  ", res)
            if (!res.ok) throw await res.json();
            return res.json();
        })
        .then((json) => {
            console.log("get lines ############## ", json)
            return json.data;
        })
        .catch((err) => {
            error = err;
            console.log(err);
            return null;
        });

    if (error) {
        throw error;
    }

    return res;

}
export const getConsumerDetails = async (consumerId: string) => {
    let error = null;

    const res = await fetch(`${GRIDAPPSD_API_BASE_URL}/grid/consumers/${consumerId}`, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
        }
    })
        .then(async (res) => {
            console.log("get consumers  ", res)
            if (!res.ok) throw await res.json();
            return res.json();
        })
        .then((json) => {
            console.log("get consumers ############## ", json)
            return json.data;
        })
        .catch((err) => {
            error = err;
            console.log(err);
            return null;
        });

    if (error) {
        throw error;
    }

    return res;

}


export const getComponentDetails = async (componentId: string, componentType: CIMComponentType) => {
    try {
        let endpoint = '';
        switch (componentType) {
            case CIMComponentTypes.PowerTransformer:
                endpoint = `/grid/transformers/${componentId}`;
                break;
            case CIMComponentTypes.RatioTapChanger:
                endpoint = `/grid/regulators/${componentId}`;
                break;
            case CIMComponentTypes.ACLineSegment:
                endpoint = `/grid/lines/${componentId}`;
                break;
            case CIMComponentTypes.EnergyConsumer:
                endpoint = `/grid/consumers/${componentId}`;
                break;
            case CIMComponentTypes.BatteryUnit:
                endpoint = `/grid/batteries/${componentId}`;
                break;
            case CIMComponentTypes.PhotovoltaicUnit:
                endpoint = `/grid/photovoltaics/${componentId}`;
                break;
            case CIMComponentTypes.SynchronousMachine:
                endpoint = `/grid/synchronousmachines/${componentId}`;
                break;
            case CIMComponentTypes.EnergySource:
                endpoint = `/grid/energysources/${componentId}`;
                break;
            case CIMComponentTypes.LinearShuntCompensator:
                endpoint = `/grid/linearshuntcompensators/${componentId}`;
                break;
            case CIMComponentTypes.LoadBreakSwitch:
            case CIMComponentTypes.Breaker:
            case CIMComponentTypes.Recloser:
            case CIMComponentTypes.Fuse:
                endpoint = `/grid/switches/${componentId}`;
                break;
            default:
                throw new Error(`Unsupported component type: ${componentType}`);
        }

        const response = await fetch(`${GRIDAPPSD_API_BASE_URL}${endpoint}`);
        if (!response.ok) {
            throw new Error(`API returned ${response.status}`);
        }

        const data = await response.json();
        if (data.status === 'success' && data.data) {
            return data.data;
        } else {
            throw new Error(data.message || 'Unknown error');
        }
    } catch (error) {
        console.error(`Error fetching ${componentType} details:`, error);
        throw error;
    }
}


