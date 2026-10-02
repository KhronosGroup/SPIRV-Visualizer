// Copyright (c) 2026 The Khronos Group Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
'use strict';

//
// Layout and drawing of the DAG shown for an instruction, with no library
//
// A layered ("Sugiyama" style) drawing: parents are drawn above their children and edges go down.
// Every step is linear in the size of the graph (plus a sort per layer), so an id with hundreds of
// consumers can't hang the page the way an optimal crossing minimizer does.
//

// @param nodes Array of {id, parentIds}. Ids are unique and parentIds reference other ids in the array
//              (a parent that is not in the array is ignored)
// @param options {nodeWidth, nodeHeight, wrapThreshold, nodesPerRow}
//        nodeWidth/nodeHeight is the space a node takes up (center to center)
//        A layer with more than wrapThreshold nodes is wrapped into rows of nodesPerRow nodes
// @return {nodes, edges, width, height}
//         nodes: [{id, x, y, data}] with x/y the center of the node, data the node passed in
//         edges: [{source, target, points: [{x, y}, ...]}] source/target are the layout nodes,
//                points go from the source center to the target center through any layers in between
//         width/height: the largest x/y of a node center
function layoutDag(nodes, options) {
    const children = new Map();
    for (const node of nodes) {
        children.set(node.id, []);
    }
    for (const node of nodes) {
        for (const parentId of node.parentIds) {
            if (children.has(parentId)) {
                children.get(parentId).push(node.id);
            }
        }
    }

    // Layering: a node's "height" is the longest path down to a node with no children.
    // Using the height (instead of the depth from the roots) keeps every node as close to the
    // instructions that use it as possible, so a type or constant sits right above its first use.
    const heights = new Map();
    function getHeight(id) {
        if (heights.has(id)) {
            return heights.get(id);
        }
        heights.set(id, 0);  // also stops a cycle from recursing forever (the back edge just points up)
        let height = 0;
        for (const childId of children.get(id)) {
            height = Math.max(height, getHeight(childId) + 1);
        }
        heights.set(id, height);
        return height;
    }
    let maxHeight = 0;
    for (const node of nodes) {
        maxHeight = Math.max(maxHeight, getHeight(node.id));
    }

    // layers[i] holds the layout nodes (real and dummy) drawn in row i, top to bottom
    const layers = [];
    for (let i = 0; i <= maxHeight; i++) {
        layers.push([]);
    }
    const layoutNodes = new Map();
    for (const node of nodes) {
        const layoutNode = {id: node.id, data: node, layer: maxHeight - heights.get(node.id), x: 0, y: 0, up: [], down: []};
        layoutNodes.set(node.id, layoutNode);
        layers[layoutNode.layer].push(layoutNode);
    }

    // An edge that spans more than one layer gets a dummy node in each layer it passes, so the
    // crossing reduction can route it and the drawn line bends around the nodes in between
    const edges = [];
    for (const node of nodes) {
        const target = layoutNodes.get(node.id);
        for (const parentId of node.parentIds) {
            const source = layoutNodes.get(parentId);
            if (source == undefined) {
                continue;
            }
            const chain = [source];
            for (let layer = source.layer + 1; layer < target.layer; layer++) {
                const dummy = {id: undefined, data: undefined, layer: layer, x: 0, y: 0, up: [], down: []};
                layers[layer].push(dummy);
                chain.push(dummy);
            }
            chain.push(target);
            for (let i = 0; i + 1 < chain.length; i++) {
                chain[i].down.push(chain[i + 1]);
                chain[i + 1].up.push(chain[i]);
            }
            edges.push({source: source, target: target, chain: chain});
        }
    }

    // Crossing reduction: a few barycenter sweeps. Each node moves to the average position of its
    // neighbors in the layer above (sweeping down) or below (sweeping up). Nodes with no neighbor on that
    // side keep their position.
    for (const layer of layers) {
        layer.forEach((node, index) => node.index = index);
    }
    function orderLayer(layer, side) {
        const keys = new Map();
        for (const node of layer) {
            const neighbors = node[side];
            let key = node.index;
            if (neighbors.length > 0) {
                key = neighbors.reduce((sum, neighbor) => sum + neighbor.index, 0) / neighbors.length;
            }
            keys.set(node, key);
        }
        layer.sort((a, b) => (keys.get(a) - keys.get(b)) || (a.index - b.index));
        layer.forEach((node, index) => node.index = index);
    }
    const sweeps = 4;
    for (let sweep = 0; sweep < sweeps; sweep++) {
        for (let i = 1; i < layers.length; i++) {
            orderLayer(layers[i], 'up');
        }
        for (let i = layers.length - 2; i >= 0; i--) {
            orderLayer(layers[i], 'down');
        }
    }

    // Coordinates: nodes in a layer sit next to each other and each layer is centered.
    // A very wide layer is wrapped into rows so a long list of consumers becomes a grid instead of a
    // strip many screens wide.
    let y = 0;
    let halfWidth = 0;
    for (const layer of layers) {
        if (layer.length == 0) {
            continue;  // only happens when a cycle made an edge point up
        }
        const perRow = (layer.length > options.wrapThreshold) ? options.nodesPerRow : layer.length;
        const rows = Math.ceil(layer.length / perRow);
        for (let i = 0; i < layer.length; i++) {
            const row = Math.floor(i / perRow);
            const nodesInRow = Math.min(perRow, layer.length - row * perRow);
            layer[i].x = ((i % perRow) - (nodesInRow - 1) / 2) * options.nodeWidth;
            layer[i].y = y + row * options.nodeHeight;
            halfWidth = Math.max(halfWidth, Math.abs(layer[i].x));
        }
        y += rows * options.nodeHeight;
    }
    // Shift so the left most node center is at x == 0
    for (const layer of layers) {
        for (const node of layer) {
            node.x += halfWidth;
        }
    }

    return {
        nodes: Array.from(layoutNodes.values()),
        edges: edges.map(edge => ({
                             source: edge.source,
                             target: edge.target,
                             points: edge.chain.map(node => ({x: node.x, y: node.y})),
                         })),
        width: halfWidth * 2,
        height: Math.max(0, y - options.nodeHeight),
    };
}

// SVG path through the points of an edge, leaving and entering each node vertically
function dagEdgePath(points) {
    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
        const from = points[i - 1];
        const to = points[i];
        const midY = (from.y + to.y) / 2;
        path += ` C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`;
    }
    return path;
}

// Draws a layout from layoutDag() into an <svg>, replacing what was there
// @param options {nodeWidth, nodeHeight, rectWidth, rectHeight, lineHeight, maxLines, minWidth, minHeight, maxScale,
//                 color(node), textColor(node), onClick(node, g), onEnter(node, g), onLeave(node, g), onMove(event)}
//        color/textColor return CSS colors for the node, the on* callbacks get the layout node and its <g>
function drawDagSvg(svg, layout, options) {
    const svgNS = 'http://www.w3.org/2000/svg';
    function createElement(name, attributes) {
        const element = document.createElementNS(svgNS, name);
        for (const key in attributes) {
            element.setAttribute(key, attributes[key]);
        }
        return element;
    }

    svg.replaceChildren();

    // The graph is drawn with half a node of padding on each side so the nodes at the edges aren't cut in half.
    // A small graph is scaled up (keeping its aspect ratio) so a few nodes aren't tiny, but at most by options.maxScale
    // so it doesn't get comically large either, and centered in the available space. Once the graph is as big as the
    // space at its normal size it is drawn at that size and scrolls.
    const graphWidth = layout.width + options.nodeWidth;
    const graphHeight = layout.height + options.nodeHeight;
    const scale = Math.min(options.minWidth / graphWidth, options.minHeight / graphHeight, options.maxScale);
    if (scale > 1) {
        // The viewBox is the available space in graph units, with the graph in the middle of it
        const viewWidth = options.minWidth / scale;
        const viewHeight = options.minHeight / scale;
        svg.setAttribute('width', options.minWidth);
        svg.setAttribute('height', options.minHeight);
        svg.setAttribute('viewBox', `${- options.nodeWidth / 2 - (viewWidth - graphWidth) / 2} ${- options.nodeHeight / 2 - (viewHeight - graphHeight) / 2} ${viewWidth} ${viewHeight}`);
    } else {
        svg.setAttribute('width', graphWidth);
        svg.setAttribute('height', graphHeight);
        svg.setAttribute('viewBox', `${- options.nodeWidth / 2} ${- options.nodeHeight / 2} ${graphWidth} ${graphHeight}`);
    }

    // Edges, each a gradient from the source node color to the target node color
    const defs = createElement('defs', {});
    svg.appendChild(defs);
    const edgeGroup = createElement('g', {});
    svg.appendChild(edgeGroup);
    for (const edge of layout.edges) {
        const gradientId = `dagEdge_${edge.source.id}_${edge.target.id}`;
        const gradient = createElement('linearGradient', {
            'id': gradientId,
            'gradientUnits': 'userSpaceOnUse',
            'x1': edge.source.x,
            'y1': edge.source.y,
            'x2': edge.target.x,
            'y2': edge.target.y,
        });
        gradient.appendChild(createElement('stop', {'offset': '0%', 'stop-color': options.color(edge.source)}));
        gradient.appendChild(createElement('stop', {'offset': '100%', 'stop-color': options.color(edge.target)}));
        defs.appendChild(gradient);

        edgeGroup.appendChild(createElement('path', {
            'd': dagEdgePath(edge.points),
            'fill': 'none',
            'stroke-width': 3,
            'stroke': `url(#${gradientId})`,
        }));
    }

    // Nodes, drawn after the edges so they are on top
    const nodeGroup = createElement('g', {});
    svg.appendChild(nodeGroup);
    for (const node of layout.nodes) {
        const g = createElement('g', {'transform': `translate(${node.x}, ${node.y})`, 'id': 'node' + node.id});
        g.appendChild(createElement('rect', {
            'width': options.rectWidth,
            'height': options.rectHeight,
            'x': -(options.rectWidth / 2),
            'y': -(options.rectHeight / 2),
            'fill': options.color(node),
            'stroke': 'black',
        }));

        // One line per text entry, "..." on the last line if there are more lines than fit
        const text = createElement('text', {
            'font-weight': 'bold',
            'text-anchor': 'middle',
            'y': -(options.rectHeight / 2),  // puts text aligned with top of rect
            'fill': options.textColor(node),
        });
        const lines = node.data.text;
        const shownLines = Math.min(lines.length, options.maxLines);
        for (let i = 0; i < shownLines; i++) {
            const tspan = createElement('tspan', {'x': 0, 'dy': options.lineHeight});
            tspan.textContent = (i == options.maxLines - 1 && lines.length > options.maxLines) ? '...' : lines[i];
            text.appendChild(tspan);
        }
        g.appendChild(text);

        g.addEventListener('click', () => options.onClick(node, g));
        g.addEventListener('mouseenter', () => options.onEnter(node, g));
        g.addEventListener('mouseleave', () => options.onLeave(node, g));
        g.addEventListener('mousemove', options.onMove);
        nodeGroup.appendChild(g);
    }
}
