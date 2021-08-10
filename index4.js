const skeldjs = require("@skeldjs/client");
const protocol = require("@skeldjs/protocol");
const { Vector2, Int2Code, HazelWriter } = require("@skeldjs/util");

const getPixels = require("get-pixels");
const fs = require("fs");

const client = new skeldjs.SkeldjsClient("2021.6.30s", { attemptAuth: true });

const getPixelsAsync = (url) => {
    return new Promise((res, rej) => {
        getPixels(url, "image/png", (err, pix) => err ? rej(err) : res(pix));
    });
}

var base_colors=[...Object.entries(skeldjs.ColorCodes)].map(([i ,x]) => [i, x.highlightHex]);

function getNearestColour(color) {
    //Convert to RGB, then R, G, B
    var [ color_r, color_g, color_b ] = color;

    //Create an emtyp array for the difference betwwen the colors
    var differenceArray=[];

    //Function to find the smallest value in an array
    Array.min = function( array ){
        return Math.min.apply( Math, array );
    };


    //Convert the HEX color in the array to RGB colors, split them up to R-G-B, then find out the difference between the "color" and the colors in the array
    base_colors.forEach(function(value) { 
        var [ base_colors_r, base_colors_g, base_colors_b ] = hex2rgb(value[1]);

        //Add the difference to the differenceArray
        differenceArray.push(Math.sqrt((color_r-base_colors_r)*(color_r-base_colors_r)+(color_g-base_colors_g)*(color_g-base_colors_g)+(color_b-base_colors_b)*(color_b-base_colors_b)));
    });

    //Get the lowest number from the differenceArray
    var lowest = Array.min(differenceArray);

    //Get the index for that lowest number
    var index = differenceArray.indexOf(lowest);

    //Function to convert HEX to RGB
    function hex2rgb( colour ) {
        var r,g,b;
        if ( colour.charAt(0) == '#' ) {
            colour = colour.substr(1);
        }

        r = colour.charAt(0) + colour.charAt(1);
        g = colour.charAt(2) + colour.charAt(3);
        b = colour.charAt(4) + colour.charAt(5);

        r = parseInt( r,16 );
        g = parseInt( g,16 );
        b = parseInt( b ,16);
        return [ r, g, b ];
    }

    //Return the HEX code
    return base_colors[index];
}

(async () => {
    console.log("connecting to server..");
    await client.connect("NA", "weakeyes", 22023);
/*
    console.log("joining..");
    await client.joinGame(process.argv[2]);

    client.me.control.checkName("awooga");
    client.me.control.checkColor(skeldjs.Color.Blue);

    let i = 0;
    let j = 0;
    const hostTransform = client.host.transform;
    setInterval(() => {
        i += 1;
        j += 0.3;

        client.me.transform.snapTo(
            new Vector2(
                hostTransform.position.x + (Math.sin(i) * (Math.sin(j) + 1)),
                hostTransform.position.y + (Math.cos(i) * (Math.sin(j) + 1))
            )
        );
    }, 50);*/

    console.log("creating..");
    await client.createGame({ maxPlayers: 15 });

    console.log("code:", Int2Code(client.code));

    let seqid = 0;
    async function snapTo(netid, x, y) {
        await client.send(
            new protocol.ReliablePacket(
                client.getNextNonce(),
                [
                    new protocol.GameDataMessage(
                        client.code,
                        [
                            new protocol.RpcMessage(
                                netid,
                                new protocol.SnapToMessage(new Vector2(x, y), ++seqid)
                            )
                        ]
                    )
                ]
            )
        )
    }

    const imagePixels = await getPixelsAsync(fs.readFileSync(process.argv[2]));
    const imageWidth = imagePixels.shape[0];
    const imageHeight = imagePixels.shape[1];

    const resX = parseInt(process.argv[3]);
    const resY = parseInt(process.argv[4]);

    const playerName = " ";

    await client.wait("player.chat");
    /**
     * @type {{components: [ skeldjs.PlayerControl, unknown, skeldjs.CustomNetworkTransform ]}[]}
     */
    const players = [];
    let incrPlayerId = 2;
    for (let y = 0; y < resY; y++) {
        for (let x = 0; x < resX; x++) {
            const pixelX = Math.floor(imageWidth / resX * x);
            const pixelY = Math.floor(imageHeight / resY * y);

            const pixelI = (pixelX + (pixelY * imageWidth)) * 4;
            const pixelClr = imagePixels.data.slice(pixelI, pixelI + 4);

            if (pixelClr[3] < 120) {
                continue;
            }

            const skeldjsColor = getNearestColour(pixelClr);
            const skeldjsColorId = parseInt(skeldjsColor[0]);

            const pcNetId = client.getNextNetId();
            const ppNetId = client.getNextNetId();
            const cntNetId = client.getNextNetId();
    
            const playerId = incrPlayerId++;
    
            const transform = new skeldjs.CustomNetworkTransform(client, cntNetId, -2, {
                position: new Vector2(x / 3 - 2, -(y / 3) + 3)
            });
            const transformWriter = HazelWriter.alloc(12);
            transform.Serialize(transformWriter, false);
    
            const gamedataWriter = HazelWriter.alloc(4 + playerName.length + 6);
            const mwriter = gamedataWriter.begin(playerId);
            mwriter.string(playerName);
            mwriter.packed(skeldjsColorId);
            mwriter.upacked(0);
            mwriter.upacked(0);
            mwriter.upacked(0);
            mwriter.byte(0);
            mwriter.uint8(0);
            gamedataWriter.end();
    
            await client.send(
                new protocol.ReliablePacket(
                    client.getNextNonce(),
                    [
                        new protocol.GameDataMessage(
                            client.code,
                            [
                                new protocol.SpawnMessage(
                                    skeldjs.SpawnType.Player,
                                    client.hostid,
                                    0,
                                    [
                                        new protocol.ComponentSpawnData(
                                            pcNetId,
                                            Buffer.from("00" + playerId.toString(16).padStart(2, "0"), "hex")
                                        ),
                                        new protocol.ComponentSpawnData(
                                            ppNetId,
                                            Buffer.alloc(0)
                                        ),
                                        new protocol.ComponentSpawnData(
                                            cntNetId,
                                            transformWriter.buffer
                                        )
                                    ]
                                ),
                                new protocol.RpcMessage(
                                    pcNetId,
                                    new protocol.SetNameMessage(playerName)
                                ),
                                new protocol.RpcMessage(
                                    pcNetId,
                                    new protocol.SetColorMessage(skeldjsColorId)
                                ),
                                new protocol.DataMessage(
                                    client.gamedata.netid,
                                    gamedataWriter.buffer
                                )
                            ]
                        )
                    ]
                )
            );
            
            players.push({
                pcNetId,
                ppNetId,
                cntNetId,
                playerId,
                seqId: 5
            });
        }
    }
})();