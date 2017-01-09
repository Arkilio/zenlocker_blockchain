var Web3 = require("web3");
var SolidityEvent = require("web3/lib/web3/event.js");

(function() {
  // Planned for future features, logging, etc.
  function Provider(provider) {
    this.provider = provider;
  }

  Provider.prototype.send = function() {
    this.provider.send.apply(this.provider, arguments);
  };

  Provider.prototype.sendAsync = function() {
    this.provider.sendAsync.apply(this.provider, arguments);
  };

  var BigNumber = (new Web3()).toBigNumber(0).constructor;

  var Utils = {
    is_object: function(val) {
      return typeof val == "object" && !Array.isArray(val);
    },
    is_big_number: function(val) {
      if (typeof val != "object") return false;

      // Instanceof won't work because we have multiple versions of Web3.
      try {
        new BigNumber(val);
        return true;
      } catch (e) {
        return false;
      }
    },
    merge: function() {
      var merged = {};
      var args = Array.prototype.slice.call(arguments);

      for (var i = 0; i < args.length; i++) {
        var object = args[i];
        var keys = Object.keys(object);
        for (var j = 0; j < keys.length; j++) {
          var key = keys[j];
          var value = object[key];
          merged[key] = value;
        }
      }

      return merged;
    },
    promisifyFunction: function(fn, C) {
      var self = this;
      return function() {
        var instance = this;

        var args = Array.prototype.slice.call(arguments);
        var tx_params = {};
        var last_arg = args[args.length - 1];

        // It's only tx_params if it's an object and not a BigNumber.
        if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
          tx_params = args.pop();
        }

        tx_params = Utils.merge(C.class_defaults, tx_params);

        return new Promise(function(accept, reject) {
          var callback = function(error, result) {
            if (error != null) {
              reject(error);
            } else {
              accept(result);
            }
          };
          args.push(tx_params, callback);
          fn.apply(instance.contract, args);
        });
      };
    },
    synchronizeFunction: function(fn, instance, C) {
      var self = this;
      return function() {
        var args = Array.prototype.slice.call(arguments);
        var tx_params = {};
        var last_arg = args[args.length - 1];

        // It's only tx_params if it's an object and not a BigNumber.
        if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
          tx_params = args.pop();
        }

        tx_params = Utils.merge(C.class_defaults, tx_params);

        return new Promise(function(accept, reject) {

          var decodeLogs = function(logs) {
            return logs.map(function(log) {
              var logABI = C.events[log.topics[0]];

              if (logABI == null) {
                return null;
              }

              var decoder = new SolidityEvent(null, logABI, instance.address);
              return decoder.decode(log);
            }).filter(function(log) {
              return log != null;
            });
          };

          var callback = function(error, tx) {
            if (error != null) {
              reject(error);
              return;
            }

            var timeout = C.synchronization_timeout || 240000;
            var start = new Date().getTime();

            var make_attempt = function() {
              C.web3.eth.getTransactionReceipt(tx, function(err, receipt) {
                if (err) return reject(err);

                if (receipt != null) {
                  // If they've opted into next gen, return more information.
                  if (C.next_gen == true) {
                    return accept({
                      tx: tx,
                      receipt: receipt,
                      logs: decodeLogs(receipt.logs)
                    });
                  } else {
                    return accept(tx);
                  }
                }

                if (timeout > 0 && new Date().getTime() - start > timeout) {
                  return reject(new Error("Transaction " + tx + " wasn't processed in " + (timeout / 1000) + " seconds!"));
                }

                setTimeout(make_attempt, 1000);
              });
            };

            make_attempt();
          };

          args.push(tx_params, callback);
          fn.apply(self, args);
        });
      };
    }
  };

  function instantiate(instance, contract) {
    instance.contract = contract;
    var constructor = instance.constructor;

    // Provision our functions.
    for (var i = 0; i < instance.abi.length; i++) {
      var item = instance.abi[i];
      if (item.type == "function") {
        if (item.constant == true) {
          instance[item.name] = Utils.promisifyFunction(contract[item.name], constructor);
        } else {
          instance[item.name] = Utils.synchronizeFunction(contract[item.name], instance, constructor);
        }

        instance[item.name].call = Utils.promisifyFunction(contract[item.name].call, constructor);
        instance[item.name].sendTransaction = Utils.promisifyFunction(contract[item.name].sendTransaction, constructor);
        instance[item.name].request = contract[item.name].request;
        instance[item.name].estimateGas = Utils.promisifyFunction(contract[item.name].estimateGas, constructor);
      }

      if (item.type == "event") {
        instance[item.name] = contract[item.name];
      }
    }

    instance.allEvents = contract.allEvents;
    instance.address = contract.address;
    instance.transactionHash = contract.transactionHash;
  };

  // Use inheritance to create a clone of this contract,
  // and copy over contract's static functions.
  function mutate(fn) {
    var temp = function Clone() { return fn.apply(this, arguments); };

    Object.keys(fn).forEach(function(key) {
      temp[key] = fn[key];
    });

    temp.prototype = Object.create(fn.prototype);
    bootstrap(temp);
    return temp;
  };

  function bootstrap(fn) {
    fn.web3 = new Web3();
    fn.class_defaults  = fn.prototype.defaults || {};

    // Set the network iniitally to make default data available and re-use code.
    // Then remove the saved network id so the network will be auto-detected on first use.
    fn.setNetwork("default");
    fn.network_id = null;
    return fn;
  };

  // Accepts a contract object created with web3.eth.contract.
  // Optionally, if called without `new`, accepts a network_id and will
  // create a new version of the contract abstraction with that network_id set.
  function Contract() {
    if (this instanceof Contract) {
      instantiate(this, arguments[0]);
    } else {
      var C = mutate(Contract);
      var network_id = arguments.length > 0 ? arguments[0] : "default";
      C.setNetwork(network_id);
      return C;
    }
  };

  Contract.currentProvider = null;

  Contract.setProvider = function(provider) {
    var wrapped = new Provider(provider);
    this.web3.setProvider(wrapped);
    this.currentProvider = provider;
  };

  Contract.new = function() {
    if (this.currentProvider == null) {
      throw new Error("Documents error: Please call setProvider() first before calling new().");
    }

    var args = Array.prototype.slice.call(arguments);

    if (!this.unlinked_binary) {
      throw new Error("Documents error: contract binary not set. Can't deploy new instance.");
    }

    var regex = /__[^_]+_+/g;
    var unlinked_libraries = this.binary.match(regex);

    if (unlinked_libraries != null) {
      unlinked_libraries = unlinked_libraries.map(function(name) {
        // Remove underscores
        return name.replace(/_/g, "");
      }).sort().filter(function(name, index, arr) {
        // Remove duplicates
        if (index + 1 >= arr.length) {
          return true;
        }

        return name != arr[index + 1];
      }).join(", ");

      throw new Error("Documents contains unresolved libraries. You must deploy and link the following libraries before you can deploy a new version of Documents: " + unlinked_libraries);
    }

    var self = this;

    return new Promise(function(accept, reject) {
      var contract_class = self.web3.eth.contract(self.abi);
      var tx_params = {};
      var last_arg = args[args.length - 1];

      // It's only tx_params if it's an object and not a BigNumber.
      if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
        tx_params = args.pop();
      }

      tx_params = Utils.merge(self.class_defaults, tx_params);

      if (tx_params.data == null) {
        tx_params.data = self.binary;
      }

      // web3 0.9.0 and above calls new twice this callback twice.
      // Why, I have no idea...
      var intermediary = function(err, web3_instance) {
        if (err != null) {
          reject(err);
          return;
        }

        if (err == null && web3_instance != null && web3_instance.address != null) {
          accept(new self(web3_instance));
        }
      };

      args.push(tx_params, intermediary);
      contract_class.new.apply(contract_class, args);
    });
  };

  Contract.at = function(address) {
    if (address == null || typeof address != "string" || address.length != 42) {
      throw new Error("Invalid address passed to Documents.at(): " + address);
    }

    var contract_class = this.web3.eth.contract(this.abi);
    var contract = contract_class.at(address);

    return new this(contract);
  };

  Contract.deployed = function() {
    if (!this.address) {
      throw new Error("Cannot find deployed address: Documents not deployed or address not set.");
    }

    return this.at(this.address);
  };

  Contract.defaults = function(class_defaults) {
    if (this.class_defaults == null) {
      this.class_defaults = {};
    }

    if (class_defaults == null) {
      class_defaults = {};
    }

    var self = this;
    Object.keys(class_defaults).forEach(function(key) {
      var value = class_defaults[key];
      self.class_defaults[key] = value;
    });

    return this.class_defaults;
  };

  Contract.extend = function() {
    var args = Array.prototype.slice.call(arguments);

    for (var i = 0; i < arguments.length; i++) {
      var object = arguments[i];
      var keys = Object.keys(object);
      for (var j = 0; j < keys.length; j++) {
        var key = keys[j];
        var value = object[key];
        this.prototype[key] = value;
      }
    }
  };

  Contract.all_networks = {
  "default": {
    "abi": [
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "name": "docIdHash",
        "outputs": [
          {
            "name": "",
            "type": "bytes32"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "docID",
            "type": "uint256"
          }
        ],
        "name": "getAssignee",
        "outputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "docHash",
            "type": "bytes32"
          }
        ],
        "name": "getDocumentByHash",
        "outputs": [
          {
            "name": "issuer",
            "type": "address"
          },
          {
            "name": "assignee",
            "type": "address"
          },
          {
            "name": "assigneeHash",
            "type": "bytes"
          },
          {
            "name": "_id",
            "type": "uint256"
          },
          {
            "name": "timestamp",
            "type": "uint256"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "extension",
            "type": "string"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "bytes32"
          }
        ],
        "name": "documents",
        "outputs": [
          {
            "name": "added",
            "type": "bool"
          },
          {
            "name": "assigneeHash",
            "type": "bytes"
          },
          {
            "name": "assignee",
            "type": "address"
          },
          {
            "name": "issuer",
            "type": "address"
          },
          {
            "name": "verified",
            "type": "bool"
          },
          {
            "name": "revoked",
            "type": "bool"
          },
          {
            "name": "id",
            "type": "uint256"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "extension",
            "type": "string"
          },
          {
            "name": "timestamp",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "docID",
            "type": "uint256"
          }
        ],
        "name": "verifyDocument",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "docHash",
            "type": "bytes32"
          },
          {
            "name": "assigneeHash",
            "type": "bytes"
          },
          {
            "name": "assignee",
            "type": "address"
          },
          {
            "name": "docName",
            "type": "string"
          },
          {
            "name": "extension",
            "type": "string"
          }
        ],
        "name": "addDocument",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "docID",
            "type": "uint256"
          }
        ],
        "name": "getDocumentHash",
        "outputs": [
          {
            "name": "docHash",
            "type": "bytes32"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "assignee",
            "type": "address"
          }
        ],
        "name": "getDocumentsIssuedTo",
        "outputs": [
          {
            "name": "",
            "type": "uint256[]"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "docID",
            "type": "uint256"
          }
        ],
        "name": "getIssuer",
        "outputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "docID",
            "type": "uint256"
          }
        ],
        "name": "getDocumentById",
        "outputs": [
          {
            "name": "issuer",
            "type": "address"
          },
          {
            "name": "assignee",
            "type": "address"
          },
          {
            "name": "assigneeHash",
            "type": "bytes"
          },
          {
            "name": "_id",
            "type": "uint256"
          },
          {
            "name": "timestamp",
            "type": "uint256"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "extension",
            "type": "string"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "docID",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "docID",
            "type": "uint256"
          }
        ],
        "name": "revokeDocument",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "assignee",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "docHash",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "assigneeHash",
            "type": "bytes"
          },
          {
            "indexed": false,
            "name": "docID",
            "type": "uint256"
          }
        ],
        "name": "DocumentAdded",
        "type": "event"
      }
    ],
    "unlinked_binary": "0x6060604052600160006000505561111b8061001a6000396000f3606060405236156100975760e060020a60003504620507b5811461009c57806307b31818146100b957806307fb5bc2146101065780632b2805db146101165780636dda61d9146101815780637c84e16f146102095780638796ec86146102fc578063905c47341461031c57806392089c461461039c578063e0de22dd146103d0578063e4364266146104c1578063fba1842a146104cf575b610002565b346100025761055360043560036020526000908152604090205481565b346100025760043560009081526003602090815260408083205483526001909152902060020154600160a060020a03165b60408051600160a060020a039092168252519081900360200190f35b346100025761056560043561041b565b34610002576106bf60043560016020819052600091825260409091208054600282015460038301546004840154600785015460ff94851696860195600160a060020a03948516959484169460a060020a850481169460a860020a90041692916005820191600601908a565b3461000257610894600435600081815260036020908152604080832054835260019091529020805460ff1615806101c95750600281015433600160a060020a03908116911614155b806101e45750600381015460a860020a900460ff1615156001145b806101ff5750600381015460a060020a900460ff1615156001145b15610a4f57610002565b346100025760408051602060046024803582810135601f8101859004850286018501909652858552610894958335959394604494939290920191819084018382808284375050604080516020606435808b0135601f81018390048302840183019094528383529799983598976084975091955060249190910193509091508190840183828082843750506040805160209735808a0135601f81018a90048a0283018a0190935282825296989760a4979196506024919091019450909250829150840183828082843750949650505050505050600085815260016020819052604082205460ff1615151415610a7957610002565b34610002576105536004356000818152600360205260409020545b919050565b346100025761089660043560408051602081810183526000808352600160a060020a0385168152600282528390208054845181840281018401909552808552929392909183018282801561039057602002820191906000526020600020905b8154815260019091019060200180831161037b575b50505050509050610317565b3461000257600435600090815260036020818152604080842054845260019091529091200154600160a060020a03166100ea565b346100025761056560043560408051602081810183526000808352835180830185528181528451808401865282815286835260039093529381205490938493928492839291906110dd815b6040805160208181018352600080835283518083018552818152845180840186528281528683526001808552868420600381015460028083015483850180548c51601f978216156101000260001901909116939093049586018a90048a0283018a01909b52848252600160a060020a039283169a92169897879695949192919083018282801561094b5780601f106109205761010080835404028352916020019161094b565b346100025761055360005481565b3461000257610894600435600081815260036020908152604080832054835260019091529020805460ff1615806105175750600381015433600160a060020a03908116911614155b806105325750600381015460a860020a900460ff1615156001145b806105495750600381015460a060020a900460ff16155b156110f057610002565b60408051918252519081900360200190f35b6040518088600160a060020a0316815260200187600160a060020a031681526020018060200186815260200185815260200180602001806020018481038452898181518152602001915080519060200190808383829060006004602084601f0104600302600f01f150905090810190601f1680156105f75780820380516001836020036101000a031916815260200191505b508481038352868181518152602001915080519060200190808383829060006004602084601f0104600302600f01f150905090810190601f1680156106505780820380516001836020036101000a031916815260200191505b508481038252858181518152602001915080519060200190808383829060006004602084601f0104600302600f01f150905090810190601f1680156106a95780820380516001836020036101000a031916815260200191505b509a505050505050505050505060405180910390f35b604051808b15158152602001806020018a600160a060020a0316815260200189600160a060020a0316815260200188151581526020018715158152602001868152602001806020018060200185815260200184810384528d8181546001816001161561010002031660029004815260200191508054600181600116156101000203166002900480156107925780601f1061076757610100808354040283529160200191610792565b820191906000526020600020905b81548152906001019060200180831161077557829003601f168201915b50508481038352875460026000196101006001841615020190911604808252602090910190889080156108065780601f106107db57610100808354040283529160200191610806565b820191906000526020600020905b8154815290600101906020018083116107e957829003601f168201915b505084810382528654600260001961010060018416150201909116048082526020909101908790801561087a5780601f1061084f5761010080835404028352916020019161087a565b820191906000526020600020905b81548152906001019060200180831161085d57829003601f168201915b50509d505050505050505050505050505060405180910390f35b005b60405180806020018281038252838181518152602001915080519060200190602002808383829060006004602084601f0104600302600f01f1509050019250505060405180910390f35b820191906000526020600020905b8154815290600101906020018083116108ee57829003601f168201915b50939550505050505b50919395979092949650565b820191906000526020600020905b81548152906001019060200180831161092e57829003601f168201915b505050506004830154600784015460058501805460408051602060026001851615610100026000190190941693909304601f8101849004840282018401909252818152969c50939a5091985092508301828280156109ea5780601f106109bf576101008083540402835291602001916109ea565b820191906000526020600020905b8154815290600101906020018083116109cd57829003601f168201915b5050505060068301805460408051602060026001851615610100026000190190941693909304601f810184900484028201840190925281815294975091925083018282801561090b5780601f106108e05761010080835404028352916020019161090b565b60038101805474ff0000000000000000000000000000000000000000191660a060020a1790555050565b5060008581526001602081815260408320875181840180548187529584902092959094601f60026101009284161592909202600019019092160481018490048301939192918a0190839010610af157805160ff19168380011785555b50610b219291505b80821115610bed5760008155600101610add565b82800160010185558215610ad5579182015b82811115610ad5578251826000505591602001919060010190610b03565b5050600381018054600280840180546c01000000000000000000000000808a0281900473ffffffffffffffffffffffffffffffffffffffff19909216919091179091553381020475ffffffffffffffffffffffffffffffffffffffffffff1990921691909117909155815460ff191660019081178355845160058401805460008281526020908190209295601f95831615610100026000190190921691909104840181900482019390880190839010610bf157805160ff19168380011785555b50610c21929150610add565b5090565b82800160010185558215610be1579182015b82811115610be1578251826000505591602001919060010190610c03565b505060008054600483015542600783015582516006830180548184526020938490209193601f600260001961010060018616150201909316929092048201819004830193929190870190839010610c8b57805160ff19168380011785555b50610cbb929150610add565b82800160010185558215610c7f579182015b82811115610c7f578251826000505591602001919060010190610c9d565b5050600086815260016020818152604083208454815460ff191660f860020a60ff909216820291909104178155848301805482850180548188529685902088979496919560026000196101008886161581028201909816829004601f908101939093048401979486161590940290930190931691909104929091839010610d4d57805485555b50610d89929150610add565b82800160010185558215610d4157600052602060002091601f016020900482015b82811115610d41578254825591600101919060010190610d6e565b505060028281015482820180546c01000000000000000000000000600160a060020a03938416810281900473ffffffffffffffffffffffffffffffffffffffff199283161790925560038087018054918701805492909516840293909304911617808355815460f860020a60ff60a060020a928390048116820282900490920274ff00000000000000000000000000000000000000001990931692909217808555925460a860020a908190049091168202919091040275ff000000000000000000000000000000000000000000199091161790556004808401549083015560058084018054918401805460008281526020908190209295601f60018481161561010090810260001990810190961684900483019490940486019790811615909302909301909116049290839010610ecb57805485555b50610f07929150610add565b82800160010185558215610ebf57600052602060002091601f016020900482015b82811115610ebf578254825591600101919060010190610eec565b505060068201600050816006016000509080546001816001161561010002031660029004828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10610f6c57805485555b50610fa8929150610add565b82800160010185558215610f6057600052602060002091601f016020900482015b82811115610f60578254825591600101919060010190610f8d565b5050600791820154910155600080548152600360209081526040808320899055600160a060020a038716835260029091529020805460018101808355828183801582901161100757600083815260209020611007918101908301610add565b50505060009283525060208083208354920182905560019091018255600483810154604080518b815290810182905260608185018181528b51918301919091528a51600160a060020a038b16967f385dfa55d941c3dafeb6079a14fd82924bdff3aa5a68477f379a108560a34abc968e968e9695949360808601938884019391928392869284928792601f850104600302600f01f150905090810190601f1680156110c65780820380516001836020036101000a031916815260200191505b5094505050505060405180910390a2505050505050565b9750975097509750975097509750610914565b60038101805475ff000000000000000000000000000000000000000000191660a860020a179055505056",
    "events": {
      "0x28128f4335287e0d0848c97704b77e25a494dbcef31a7831714617ec90dbc738": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "issuer",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "ipfsHash",
            "type": "bytes"
          },
          {
            "indexed": false,
            "name": "assignee",
            "type": "address"
          }
        ],
        "name": "DocumentAdded",
        "type": "event"
      },
      "0x89ed780575cff824274fb4ee297619ec46ae8ffb374dc5ecef8b06c935499714": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "confirmer",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "ipfsHash",
            "type": "bytes"
          }
        ],
        "name": "DocumentConfirmed",
        "type": "event"
      },
      "0x650c296f7c88056f6a2ef5bb6e5f361a8f23298c35007042c40d637431c8e0d5": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "assignee",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "ipfsHash",
            "type": "bytes"
          },
          {
            "indexed": false,
            "name": "docID",
            "type": "uint256"
          }
        ],
        "name": "DocumentAdded",
        "type": "event"
      },
      "0x385dfa55d941c3dafeb6079a14fd82924bdff3aa5a68477f379a108560a34abc": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "assignee",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "docHash",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "assigneeHash",
            "type": "bytes"
          },
          {
            "indexed": false,
            "name": "docID",
            "type": "uint256"
          }
        ],
        "name": "DocumentAdded",
        "type": "event"
      },
      "0x522548df57f4a37064bd1ac286242ff2293bc5f4e1ebef794a4fd3817c4e5696": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "assignee",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "docHash",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "issuerHash",
            "type": "bytes"
          },
          {
            "indexed": false,
            "name": "assigneeHash",
            "type": "bytes"
          },
          {
            "indexed": false,
            "name": "docID",
            "type": "uint256"
          }
        ],
        "name": "DocumentAdded",
        "type": "event"
      }
    },
    "updated_at": 1483913741759,
    "links": {},
    "address": "0xf322a9edd8fea4f0b023fdd29487551ffb591578"
  }
};

  Contract.checkNetwork = function(callback) {
    var self = this;

    if (this.network_id != null) {
      return callback();
    }

    this.web3.version.network(function(err, result) {
      if (err) return callback(err);

      var network_id = result.toString();

      // If we have the main network,
      if (network_id == "1") {
        var possible_ids = ["1", "live", "default"];

        for (var i = 0; i < possible_ids.length; i++) {
          var id = possible_ids[i];
          if (Contract.all_networks[id] != null) {
            network_id = id;
            break;
          }
        }
      }

      if (self.all_networks[network_id] == null) {
        return callback(new Error(self.name + " error: Can't find artifacts for network id '" + network_id + "'"));
      }

      self.setNetwork(network_id);
      callback();
    })
  };

  Contract.setNetwork = function(network_id) {
    var network = this.all_networks[network_id] || {};

    this.abi             = this.prototype.abi             = network.abi;
    this.unlinked_binary = this.prototype.unlinked_binary = network.unlinked_binary;
    this.address         = this.prototype.address         = network.address;
    this.updated_at      = this.prototype.updated_at      = network.updated_at;
    this.links           = this.prototype.links           = network.links || {};
    this.events          = this.prototype.events          = network.events || {};

    this.network_id = network_id;
  };

  Contract.networks = function() {
    return Object.keys(this.all_networks);
  };

  Contract.link = function(name, address) {
    if (typeof name == "function") {
      var contract = name;

      if (contract.address == null) {
        throw new Error("Cannot link contract without an address.");
      }

      Contract.link(contract.contract_name, contract.address);

      // Merge events so this contract knows about library's events
      Object.keys(contract.events).forEach(function(topic) {
        Contract.events[topic] = contract.events[topic];
      });

      return;
    }

    if (typeof name == "object") {
      var obj = name;
      Object.keys(obj).forEach(function(name) {
        var a = obj[name];
        Contract.link(name, a);
      });
      return;
    }

    Contract.links[name] = address;
  };

  Contract.contract_name   = Contract.prototype.contract_name   = "Documents";
  Contract.generated_with  = Contract.prototype.generated_with  = "3.2.0";

  // Allow people to opt-in to breaking changes now.
  Contract.next_gen = false;

  var properties = {
    binary: function() {
      var binary = Contract.unlinked_binary;

      Object.keys(Contract.links).forEach(function(library_name) {
        var library_address = Contract.links[library_name];
        var regex = new RegExp("__" + library_name + "_*", "g");

        binary = binary.replace(regex, library_address.replace("0x", ""));
      });

      return binary;
    }
  };

  Object.keys(properties).forEach(function(key) {
    var getter = properties[key];

    var definition = {};
    definition.enumerable = true;
    definition.configurable = false;
    definition.get = getter;

    Object.defineProperty(Contract, key, definition);
    Object.defineProperty(Contract.prototype, key, definition);
  });

  bootstrap(Contract);

  if (typeof module != "undefined" && typeof module.exports != "undefined") {
    module.exports = Contract;
  } else {
    // There will only be one version of this contract in the browser,
    // and we can use that.
    window.Documents = Contract;
  }
})();
